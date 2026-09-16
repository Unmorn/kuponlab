import { smartCoupon, targetCoupon, customCoupon } from "../lib/product.js";

export const access="public";
export const methods=["POST"];

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const uniqSets=arr=>{const seen=new Set(),out=[];for(const x of arr){const sig=(x.picks||[]).map(p=>p.matchId+":"+p.marketKey).sort().join("|");if(sig&&!seen.has(sig)){seen.add(sig);out.push(x)}}return out};
const groupOf=x=>String(x?.marketGroup||x?.group||x?.family||"standard");

function insightPack(body,items){
  const extended=!!body.extended;
  const opportunities=[];
  for(const x of items){
    const best=x.product?.bestPriced;
    if(!best||x.product?.suitability?.code==="skip")continue;
    const edge=Number(best.edge||0),risk=Number(best.risk||50),prob=Number(best.probability||0),confidence=Number(x.analysis?.confidence||0),quality=Number(x.analysis?.dataQuality||0),stability=Number(x.analysis?.stability||70);
    if(edge<=.015&&best.oddsType!=="iddaa")continue;
    const score=clamp(edge*260+confidence*.30+quality*.16+stability*.14-risk*.18,0,100);
    opportunities.push({matchId:x.event.id,match:x.event.homeTeam.name+" - "+x.event.awayTeam.name,league:x.event.tournament?.uniqueTournament?.name||x.event.tournament?.name||"Futbol",startTimestamp:x.event.startTimestamp,pick:best.label,marketKey:best.key,probability:prob,decimal:Number(best.decimal||best.fairOdds||0),openDecimal:best.openDecimal??null,oddsMovePct:best.oddsMovePct??null,edge:+edge.toFixed(4),risk,score:Math.round(score),confidence,dataQuality:quality,stability,oddsType:best.oddsType||"model_fair",iddaaStatus:best.iddaaStatus||null,mbs:best.mbs??null})
  }
  opportunities.sort((a,b)=>b.score-a.score||b.probability-a.probability);
  const couponSets={
    low:uniqSets([0,1,2,3,4].map(v=>smartCoupon(items,"low",v))),
    balanced:uniqSets([0,1,2,3,4].map(v=>smartCoupon(items,"balanced",v))),
    high:uniqSets([0,1,2,3,4].map(v=>smartCoupon(items,"high",v))),
    extreme:uniqSets([0,1,2,3,4].map(v=>smartCoupon(items,"extreme",v)))
  };
  const coupons={low:couponSets.low[0]||null,balanced:couponSets.balanced[0]||null,high:couponSets.high[0]||null,extreme:couponSets.extreme[0]||null};
  if(extended){
    for(const p of ["series5","series8","marathon13"])couponSets[p]=uniqSets([0,1,2,3,4].map(v=>smartCoupon(items,p,v)));
    for(const t of [3,5,10,20])couponSets["target"+t]=uniqSets([0,1,2,3,4].map(v=>targetCoupon(items,t,v)));
    for(const k of ["series5","series8","marathon13","target3","target5","target10","target20"])coupons[k]=couponSets[k]?.[0]||null;
  }
  const suitable=items.filter(x=>x.product?.suitability?.code==="good").length;
  const strong=items.filter(x=>x.analysis?.signal==="Güçlü").length;
  return {date:String(body.date||""),extended,summary:{totalFixtures:Number(body.totalFixtures||0),scheduled:Number(body.scheduled||0),iddaaMatches:items.filter(x=>x.analysis?.iddaa?.matched).length,pricedMatches:items.filter(x=>(x.product?.iddaaCandidates||[]).length).length,analyzed:items.length,strongSignals:strong,suitable,valueOpportunities:opportunities.length},opportunities:opportunities.slice(0,5),marketPerformance:[],coupons,couponSets,source:"KuponLab client-distributed scan"};
}

function customPack(body,items){
  const count=Math.max(2,Math.min(20,Math.round(Number(body.count||8)))),target=Math.max(1.5,Math.min(5000,Number(body.target||10))),seen=new Set(),sets=[];
  for(let v=0;v<3;v++){const c=customCoupon(items,count,target,v),sig=(c.picks||[]).map(p=>p.matchId+":"+p.marketKey).sort().join("|");if(sig&&!seen.has(sig)){seen.add(sig);sets.push(c)}}
  return {date:String(body.date||""),count,target,sets,coupon:sets[0]||null,analyzedMatches:items.length,availableMatches:Math.max(0,...sets.map(x=>Number(x.eligibleMatches||0)))}
}

function bestPack(body,items){
  const f=body.filters||{},group=String(f.group||"all"),minOdds=Number(f.minOdds||1.2),maxOdds=Number(f.maxOdds||3),maxRisk=Number(f.maxRisk||65),minProb=Number(f.minProb||45),limit=Math.max(1,Math.min(30,Number(f.limit||20))),all=[];
  for(const it of items){
    let source=it.product?.iddaaCandidates||[];
    if(!source.length){
      const p=smartCoupon([it],"balanced",0).picks?.[0]||smartCoupon([it],"high",0).picks?.[0];
      if(p)source=[{...p,key:p.marketKey,label:p.pick,family:p.marketFamily,marketGroup:p.marketGroup}]
    }
    for(const x of source){
      const g=groupOf(x),od=Number(x.decimal),risk=Number(x.risk||50),prob=Number(x.probability||0);
      if(group!=="all"&&g!==group)continue;
      if(!Number.isFinite(od)||od<minOdds||od>maxOdds||risk>maxRisk||prob<minProb)continue;
      const stability=Number(it.analysis?.stability||70),confidence=Number(it.analysis?.confidence||0),quality=Number(it.analysis?.dataQuality||0),edge=Number(x.edge||0);
      const score=clamp(prob*.42+confidence*.18+quality*.16+stability*.10-risk*.25+clamp(edge*100,-8,15)*.8,0,100);
      all.push({matchId:it.event.id,match:it.event.homeTeam.name+" - "+it.event.awayTeam.name,league:it.event.tournament?.uniqueTournament?.name||it.event.tournament?.name||"Futbol",startTimestamp:it.event.startTimestamp,marketKey:x.key,pick:x.label,group:g,marketFamily:x.family||null,probability:prob,decimal:od,oddsType:x.oddsType||"model_fair",risk,score:Math.round(score),edge:+edge.toFixed(4),confidence,dataQuality:quality,stability,marketConfidence:x.marketConfidence||null,performanceStatus:"Veri az",performanceN:0,iddaaStatus:x.oddsType==="iddaa"?"open":(x.iddaaStatus||"model_only"),mbs:x.mbs??null,openDecimal:x.openDecimal??null,oddsMovePct:x.oddsMovePct??null})
    }
  }
  all.sort((a,b)=>b.score-a.score||b.probability-a.probability||a.risk-b.risk);
  const picks=[],used=new Set();for(const x of all){if(picks.length>=limit)break;if(used.has(String(x.matchId)))continue;used.add(String(x.matchId));picks.push(x)}
  return {date:String(body.date||""),filters:f,summary:{fixtures:Number(body.totalFixtures||0),scannedMatches:items.length,iddaaMatches:items.filter(x=>x.analysis?.iddaa?.matched).length,qualified:picks.length},performance:[],picks}
}

export default async function(req,res){
  const body=req.body||{},items=Array.isArray(body.items)?body.items.filter(x=>x?.event&&x?.analysis).slice(0,40):[];
  if(!items.length)return res.status(400).json({ok:false,error:"Analiz listesi boş."});
  try{
    const mode=String(body.mode||"insights");
    const payload=mode==="custom"?customPack(body,items):mode==="best"?bestPack(body,items):insightPack(body,items);
    return res.json({ok:true,...payload})
  }catch(e){return res.status(500).json({ok:false,error:"Kupon bileşimi hazırlanamadı.",detail:String(e?.message||e)})}
}
