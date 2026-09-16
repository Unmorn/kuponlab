import { fixtures, history, analyze as build } from "./core.js";
import { marketSnapshot, buildMatchContext, compareMarket } from "./context.js";
import { loadCalibration, applyCalibration } from "./backtest.js";
import { decorateAnalysis, smartCoupon, targetCoupon, customCoupon } from "./product.js";
import { iddaaMatchSnapshot, enrichWithIddaa } from "./iddaa.js";
import { marketPerformanceSummary, applyPerformanceToAnalysis } from "./performance.js";
import { db } from "./db.js";

const cache=new Map(),analysisCache=new Map();
async function persistentGet(key){
  try{const q=await db.query("SELECT payload FROM app_cache WHERE cache_key=$1 AND expires_at>$2 LIMIT 1",[key,Math.floor(Date.now()/1000)]),raw=q.rows?.[0]?.payload;if(!raw)return null;return typeof raw==="string"?JSON.parse(raw):raw}catch{return null}
}
async function persistentSet(key,payload,minutes=15){
  try{await db.query(`INSERT INTO app_cache(cache_key,payload,expires_at,updated_at)
    VALUES($1,$2,$3,CURRENT_TIMESTAMP)
    ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at,updated_at=CURRENT_TIMESTAMP`,
    [key,JSON.stringify(payload),Math.floor(Date.now()/1000)+Math.max(1,Number(minutes)||15)*60])}catch{}
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;async function w(){while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch{out[i]=null}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>w()));return out}
export async function dailyInsights(date,{extended=false,baseUrl=""}={}){
  const ck="i:"+date+":"+(extended?"x":"n"),c=cache.get(ck);if(c&&c.e>Date.now())return {...c.v,cached:true};
  const pk="daily-insights:v52:"+date+":"+(extended?"x":"n"),pc=await persistentGet(pk);
  if(pc?.public&&Array.isArray(pc?.items)){
    analysisCache.set(date+":"+(extended?"x":"n"),{items:pc.items,e:Date.now()+900000});
    cache.set(ck,{v:pc.public,e:Date.now()+900000});
    return {...pc.public,cached:true,persistentCache:true}
  }
  const performance=await marketPerformanceSummary().catch(()=>({groups:[],byGroup:{},resolved:0}));
  const f=await fixtures(date),events=(f.events||[]),scheduled=events.filter(e=>e.status?.type==="scheduled").sort((a,b)=>a.startTimestamp-b.startTimestamp);
  const pool=scheduled.slice(0,extended?10:8),analysisPool=pool.map(event=>({event}));
  // Her maçın analizi ayrı Worker isteğinde çalışsın. Böylece tek /insights
  // isteği Cloudflare'ın dış istek limitini tüketip diğer maçları düşürmez.
  const analyses=(await mapLimit(analysisPool,2,async x=>{
    const e=x.event,source=e.dataSource||"auto";
    if(baseUrl){
      const qs=new URLSearchParams({home:String(e.homeTeam.id),away:String(e.awayTeam.id),homeName:String(e.homeTeam.name||""),awayName:String(e.awayTeam.name||""),ts:String(e.startTimestamp),event:String(e.id),source});
      if(e.iddaaEventId)qs.set("iddaaEvent",String(e.iddaaEventId));
      const rr=await fetch(String(baseUrl).replace(/\/$/,"")+"/api/analyze?"+qs.toString(),{headers:{"x-kuponlab-internal-scan":"1","accept":"application/json"}});
      if(!rr.ok)return null;
      const d=await rr.json();if(!d?.ok||!d.analysis)return null;
      let analysis=d.analysis;if(!analysis.marketPerformance&&performance?.byGroup)analysis=applyPerformanceToAnalysis(analysis,performance);const marketComparison=analysis.marketComparison||{available:false},product=analysis.product||decorateAnalysis(analysis,marketComparison);
      return {event:e,analysis,marketComparison,product}
    }
    const [h,a]=await Promise.all([history(e.homeTeam.id,e.startTimestamp,10,source),history(e.awayTeam.id,e.startTimestamp,10,source)]);
    if((h.events||[]).length<3||(a.events||[]).length<3)return null;
    const raw=build(e.homeTeam.id,e.awayTeam.id,h.events,a.events,e.startTimestamp,{teams:{home:e.homeTeam.name,away:e.awayTeam.name}}),analysis=applyCalibration(raw,[]);
    const marketComparison={available:false},product=decorateAnalysis(analysis,marketComparison);
    return {event:e,analysis,marketComparison,product}
  })).filter(Boolean);
  const pre=analyses.map(x=>({event:x.event,iddaa:{matched:!!x.analysis?.iddaa?.matched},market:x.marketComparison?.available?x.marketComparison:null}));
  const opportunities=[];
  for(const x of analyses){
    const best=x.product?.bestPriced;if(!best||best.edge<=.015||x.product.suitability.code==="skip"||Number(x.analysis.stability||70)<58)continue;
    const score=clamp(best.edge*260+x.analysis.confidence*.30+x.analysis.dataQuality*.16+Number(x.analysis.stability||70)*.14-best.risk*.18,0,100);
    opportunities.push({
      matchId:x.event.id,match:x.event.homeTeam.name+" - "+x.event.awayTeam.name,league:x.event.tournament?.uniqueTournament?.name||x.event.tournament?.name||"Futbol",
      startTimestamp:x.event.startTimestamp,pick:best.label,marketKey:best.key,probability:best.probability,decimal:best.decimal,openDecimal:best.openDecimal,
      oddsMovePct:best.oddsMovePct,edge:+best.edge.toFixed(4),risk:best.risk,score:Math.round(score),confidence:x.analysis.confidence,dataQuality:x.analysis.dataQuality,stability:Number(x.analysis.stability||70),oddsType:best.oddsType||"market",iddaaStatus:best.iddaaStatus||null,mbs:best.mbs??null
    })
  }
  opportunities.sort((a,b)=>b.score-a.score||b.edge-a.edge);
  analysisCache.set(date+":"+(extended?"x":"n"),{items:analyses,e:Date.now()+600000});
  const strong=analyses.filter(x=>x.analysis.signal==="Güçlü").length,suitable=analyses.filter(x=>x.product.suitability.code==="good").length;
  const uniqSets=arr=>{const seen=new Set(),out=[];for(const x of arr){const sig=(x.picks||[]).map(p=>p.matchId+":"+p.marketKey).sort().join("|");if(!seen.has(sig)){seen.add(sig);out.push(x)}}return out};
  const couponSets={
    low:uniqSets([0,1,2,3,4].map(v=>smartCoupon(analyses,"low",v))),
    balanced:uniqSets([0,1,2,3,4].map(v=>smartCoupon(analyses,"balanced",v))),
    high:uniqSets([0,1,2,3,4].map(v=>smartCoupon(analyses,"high",v))),
    extreme:uniqSets([0,1,2,3,4].map(v=>smartCoupon(analyses,"extreme",v)))
  };
  const coupons={low:couponSets.low[0],balanced:couponSets.balanced[0],high:couponSets.high[0],extreme:couponSets.extreme[0]};
  if(extended){
    couponSets.series5=uniqSets([0,1,2,3,4].map(v=>smartCoupon(analyses,"series5",v)));couponSets.series8=uniqSets([0,1,2,3,4].map(v=>smartCoupon(analyses,"series8",v)));couponSets.marathon13=uniqSets([0,1,2,3,4].map(v=>smartCoupon(analyses,"marathon13",v)));
    couponSets.target3=uniqSets([0,1,2,3,4].map(v=>targetCoupon(analyses,3,v)));couponSets.target5=uniqSets([0,1,2,3,4].map(v=>targetCoupon(analyses,5,v)));couponSets.target10=uniqSets([0,1,2,3,4].map(v=>targetCoupon(analyses,10,v)));couponSets.target20=uniqSets([0,1,2,3,4].map(v=>targetCoupon(analyses,20,v)));
    coupons.series5=couponSets.series5[0];coupons.series8=couponSets.series8[0];coupons.marathon13=couponSets.marathon13[0];coupons.target3=couponSets.target3[0];coupons.target5=couponSets.target5[0];coupons.target10=couponSets.target10[0];coupons.target20=couponSets.target20[0];
  }
  const v={date,extended,summary:{totalFixtures:events.length,scheduled:scheduled.length,iddaaMatches:pre.filter(x=>x?.iddaa?.matched).length,pricedMatches:pre.filter(x=>x?.iddaa?.matched||x?.market).length,analyzed:analyses.length,strongSignals:strong,suitable,valueOpportunities:opportunities.length},opportunities:opportunities.slice(0,5),marketPerformance:performance.groups,coupons,couponSets,source:(f.source||"Football data")+" + İddaa public sportsbook + KuponLab v5.2 Ensemble",cached:false};
  cache.set(ck,{v,e:Date.now()+900000});analysisCache.set(date+":"+(extended?"x":"n"),{items:analyses,e:Date.now()+900000});
  await persistentSet(pk,{public:v,items:analyses},15);return v
}
export async function customInsights(date,count=8,target=10,{baseUrl=""}={}){
  let a=analysisCache.get(date+":x");
  if(!a||a.e<Date.now()){await dailyInsights(date,{extended:true,baseUrl});a=analysisCache.get(date+":x")}
  const items=a?.items||[],seen=new Set(),sets=[];
  for(let v=0;v<5;v++){const c=customCoupon(items,count,target,v),sig=(c.picks||[]).map(p=>p.matchId+":"+p.marketKey).sort().join("|");if(sig&&!seen.has(sig)){seen.add(sig);sets.push(c)}}
  return {date,count:Number(count),target:Number(target),sets,coupon:sets[0]||null,availableMatches:items.length}
}
function bestGroup(x){const k=String(x?.key||""),g=String(x?.marketGroup||"");if(["BTTS","NBTTS"].includes(k)||g==="btts")return "goals";return g}
export async function bestPicks(date,{group="all",minOdds=1.2,maxOdds=3,maxRisk=65,minProb=45,limit=20,baseUrl=""}={}){
  const daily=await dailyInsights(date,{extended:true,baseUrl}),cached=analysisCache.get(date+":x"),items=cached?.items||[],all=[];
  for(const it of items){
    let source=it.product?.iddaaCandidates||[];
    if(!source.length){
      const fallback=smartCoupon([it],"balanced",0).picks?.[0]||smartCoupon([it],"high",0).picks?.[0]||null;
      if(fallback)source=[{...fallback,key:fallback.marketKey,label:fallback.pick,family:fallback.marketFamily,marketGroup:fallback.marketGroup}];
    }
    for(const x of source){
      const g=bestGroup(x),od=Number(x.decimal),risk=Number(x.risk||50),prob=Number(x.probability||0);
      if(group!=="all"&&g!==group)continue;if(!Number.isFinite(od)||od<minOdds||od>maxOdds||risk>maxRisk||prob<minProb)continue;
      const perf=it.analysis?.marketPerformance?.[x.marketGroup]||null,edge=Number(x.edge||0),mc=Number(x.marketConfidence||55),perfAdj=Number(perf?.adjustment||0);
      const stability=Number(it.analysis.stability||70);if(stability<55)continue;const oddsFit=Math.max(0,5-Math.abs(od-1.85)*3),score=clamp(prob*.38+Number(it.analysis.confidence||50)*.17+Number(it.analysis.dataQuality||50)*.14+stability*.12+mc*.08-risk*.25+clamp(edge*100,-8,15)*.8+perfAdj+oddsFit,0,100);
      all.push({matchId:it.event.id,match:it.event.homeTeam.name+" - "+it.event.awayTeam.name,league:it.event.tournament?.uniqueTournament?.name||it.event.tournament?.name||"Futbol",startTimestamp:it.event.startTimestamp,marketKey:x.key,pick:x.label,group:g,marketFamily:x.family||null,probability:prob,decimal:od,oddsType:x.oddsType||"model_fair",risk,score:Math.round(score),edge:+edge.toFixed(4),confidence:Number(it.analysis.confidence||0),dataQuality:Number(it.analysis.dataQuality||0),stability,marketConfidence:x.marketConfidence||null,performanceStatus:perf?.status||"Veri az",performanceN:Number(perf?.eventN||perf?.n||0),iddaaStatus:x.oddsType==="iddaa"?"open":(x.iddaaStatus||"model_only"),mbs:x.mbs??null,openDecimal:x.openDecimal??null,oddsMovePct:x.oddsMovePct??null})
    }
  }
  all.sort((a,b)=>b.score-a.score||b.probability-a.probability||a.risk-b.risk);
  const picks=[],usedMatches=new Set(),groupCount=new Map();
  for(const x of all){
    if(picks.length>=Math.max(1,Math.min(30,limit)))break;
    if(usedMatches.has(String(x.matchId)))continue;
    const n=groupCount.get(x.group)||0;if(n>=6)continue;
    picks.push(x);usedMatches.add(String(x.matchId));groupCount.set(x.group,n+1)
  }
  return {date,filters:{group,minOdds,maxOdds,maxRisk,minProb},summary:{fixtures:daily.summary?.totalFixtures||0,scannedMatches:items.length,iddaaMatches:daily.summary?.iddaaMatches||0,qualified:picks.length},performance:daily.marketPerformance||[],picks}
}
