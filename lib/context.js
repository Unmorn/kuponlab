import { history } from "./core.js";
import { globalEloAt } from "./global-elo.js";

const cache=new Map(),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cg=k=>{const x=cache.get(k);if(!x||x.e<Date.now()){cache.delete(k);return null}return x.v};
const cs=(k,v,ttl)=>cache.set(k,{v,e:Date.now()+ttl});

async function json(url,timeout=12000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
  try{const r=await fetch(url,{signal:c.signal,headers:{accept:"application/json,text/plain,*/*"}});if(!r.ok)throw new Error("HTTP "+r.status);return await r.json()}
  finally{clearTimeout(t)}
}
const score=(e,s)=>Number(e?.[s+"Score"]?.normaltime??e?.[s+"Score"]?.current??0)||0;
const american=v=>{if(v===null||v===undefined||v==="")return null;const n=Number(String(v).replace("+",""));return Number.isFinite(n)&&n!==0?n:null};
const decimal=a=>a===null?null:a>0?1+a/100:1+100/Math.abs(a);
const implied=a=>a===null?null:a>0?100/(a+100):Math.abs(a)/(Math.abs(a)+100);
function fairSet(obj){
  const keys=Object.keys(obj),vals={};let sum=0;
  for(const k of keys){const a=american(obj[k]);if(a===null)return null;const ip=implied(a);sum+=ip;vals[k]={american:a,decimal:+decimal(a).toFixed(3),implied:ip}}
  if(!sum)return null;
  for(const k of keys)vals[k].fair=+(vals[k].implied/sum).toFixed(5);
  return vals
}
function extractMarket(s){
  const o=(s?.odds||[]).find(x=>x?.moneyline||x?.homeTeamOdds||x?.total);if(!o)return null;
  const ml=o.moneyline||{},tot=o.total||{};
  const current1=fairSet({
    "1":ml.home?.close?.odds??o.homeTeamOdds?.moneyLine,
    "X":ml.draw?.close?.odds??o.drawOdds?.moneyLine,
    "2":ml.away?.close?.odds??o.awayTeamOdds?.moneyLine
  });
  const open1=fairSet({"1":ml.home?.open?.odds,"X":ml.draw?.open?.odds,"2":ml.away?.open?.odds});
  const line=Number(o.overUnder??String(tot.over?.close?.line||"").replace(/[^0-9.]/g,""));
  const current25=Math.abs(line-2.5)<.01?fairSet({O25:tot.over?.close?.odds??o.overOdds,U25:tot.under?.close?.odds??o.underOdds}):null;
  const openLine=Number(String(tot.over?.open?.line||line||"").replace(/[^0-9.]/g,""));
  const open25=Math.abs(openLine-2.5)<.01?fairSet({O25:tot.over?.open?.odds,U25:tot.under?.open?.odds}):null;
  if(!current1&&!current25)return null;
  return {provider:o.provider?.name||"Piyasa",oneXTwo:{current:current1,open:open1},total25:{line:Math.abs(line-2.5)<.01?2.5:null,current:current25,open:open25}}
}
export function compareMarket(analysis,market){
  if(!analysis||!market)return {available:false};
  const model=new Map((analysis.markets||[]).map(m=>[m.key,Number(m.probabilityRaw??m.probability/100)])),rows=[];
  const add=(current,open)=>{if(!current)return;for(const [key,v] of Object.entries(current)){const p=model.get(key);if(!Number.isFinite(p))continue;const ov=open?.[key]||null,openDecimal=ov?Number(ov.decimal):null,currentDecimal=Number(v.decimal),move=openDecimal?+(currentDecimal-openDecimal).toFixed(3):null,movePct=openDecimal?+((currentDecimal/openDecimal-1)*100).toFixed(1):null;rows.push({key,model:+p.toFixed(5),marketFair:Number(v.fair),edge:+(p-Number(v.fair)).toFixed(5),decimal:currentDecimal,american:Number(v.american),openDecimal,oddsMove:move,oddsMovePct:movePct})}};
  add(market.oneXTwo?.current,market.oneXTwo?.open);add(market.total25?.current,market.total25?.open);
  rows.sort((a,b)=>b.edge-a.edge);const best=rows[0]||null;
  return {available:rows.length>0,provider:market.provider,rows,bestEdge:best&&best.edge>0?best:null}
}

function recentPower(events,teamId){
  const a=(events||[]).slice(0,8);if(!a.length)return {rating:50,ppg:1.35,gdpg:0,n:0};
  let sw=0,pts=0,gd=0,gf=0,ga=0;
  a.forEach((e,i)=>{const h=+e.homeTeam.id===+teamId,xgf=h?score(e,"home"):score(e,"away"),xga=h?score(e,"away"):score(e,"home"),w=.86**i;sw+=w;pts+=(xgf>xga?3:xgf===xga?1:0)*w;gd+=(xgf-xga)*w;gf+=xgf*w;ga+=xga*w});
  const ppg=pts/sw,gdpg=gd/sw,attack=gf/sw,defense=ga/sw;
  const rating=clamp(50+(ppg-1.35)*12+gdpg*6+(attack-defense)*2.2,24,78);
  return {rating:+rating.toFixed(1),ppg:+ppg.toFixed(2),gdpg:+gdpg.toFixed(2),n:a.length}
}

async function opponentScheduleStrength(events,teamId,depth=3,source="auto"){
  const chosen=[],seen=new Set();
  for(const e of (events||[])){
    const opp=+e.homeTeam.id===+teamId?e.awayTeam:e.homeTeam;if(!opp?.id||seen.has(String(opp.id)))continue;
    seen.add(String(opp.id));chosen.push({id:opp.id,name:opp.name,ts:e.startTimestamp});if(chosen.length>=depth)break
  }
  const rows=await Promise.all(chosen.map(async o=>{
    try{const h=await history(o.id,o.ts,6,source);return {...o,...recentPower(h.events,o.id)}}catch{return {...o,rating:50,n:0}}
  }));
  let sw=0,sr=0;rows.forEach((x,i)=>{if(!x.n)return;const w=.82**i;sw+=w;sr+=x.rating*w});
  return {rating:+(sw?sr/sw:50).toFixed(1),sample:rows.filter(x=>x.n).length,opponents:rows.map(x=>({id:x.id,name:x.name,rating:x.rating}))}
}

function compactSummary(d){
  const odds=(d?.odds||[]).slice(0,1).map(o=>({
    provider:o.provider?{name:o.provider.name}:null,
    overUnder:o.overUnder,overOdds:o.overOdds,underOdds:o.underOdds,
    homeTeamOdds:o.homeTeamOdds?{moneyLine:o.homeTeamOdds.moneyLine}:null,
    awayTeamOdds:o.awayTeamOdds?{moneyLine:o.awayTeamOdds.moneyLine}:null,
    drawOdds:o.drawOdds?{moneyLine:o.drawOdds.moneyLine}:null,
    moneyline:o.moneyline?{
      home:{close:{odds:o.moneyline.home?.close?.odds},open:{odds:o.moneyline.home?.open?.odds}},
      draw:{close:{odds:o.moneyline.draw?.close?.odds},open:{odds:o.moneyline.draw?.open?.odds}},
      away:{close:{odds:o.moneyline.away?.close?.odds},open:{odds:o.moneyline.away?.open?.odds}}
    }:null,
    total:o.total?{
      over:{close:{line:o.total.over?.close?.line,odds:o.total.over?.close?.odds},open:{line:o.total.over?.open?.line,odds:o.total.over?.open?.odds}},
      under:{close:{line:o.total.under?.close?.line,odds:o.total.under?.close?.odds},open:{line:o.total.under?.open?.line,odds:o.total.under?.open?.odds}}
    }:null
  }));
  const comp=d?.header?.competitions?.[0],status=comp?.status?.type||{},competitors=(comp?.competitors||[]).map(x=>({id:String(x.id),homeAway:x.homeAway,name:x?.team?.displayName||x?.team?.name||x?.displayName||"",score:x.score==null?null:Number(x.score),linescores:(x.linescores||[]).map(z=>Number(z.displayValue??z.value??0))}));
  return {
    header:{
      league:d?.header?.league?{id:d.header.league.id,slug:d.header.league.slug,name:d.header.league.name}:null,
      season:d?.header?.season?{year:d.header.season.year}:null,
      event:{state:status.state||null,completed:!!status.completed,detail:status.shortDetail||status.detail||status.description||null,competitors}
    },
    odds,
    boxscore:{teams:(d?.boxscore?.teams||[]).map(t=>({team:{id:t.team?.id,displayName:t.team?.displayName||t.team?.name||""},statistics:(t.statistics||[]).map(s=>({name:s.name,displayValue:s.displayValue}))}))},
    rosters:(d?.rosters||[]).map(r=>({team:{id:r.team?.id,displayName:r.team?.displayName||r.team?.name||""},roster:(r.roster||[]).filter(x=>x?.starter).map(x=>({starter:true,athlete:{id:x.athlete?.id,displayName:x.athlete?.displayName||x.athlete?.fullName||""},position:{abbreviation:x.position?.abbreviation||"",name:x.position?.name||""}}))})),
    commentary:[...new Map((d?.commentary||[]).map(c=>c?.play).filter(p=>p?.id&&/shot|goal|yellow-card|red-card|foul|offside/i.test(p?.type?.type||"")).map(p=>[String(p.id),{id:String(p.id),type:p.type.type,text:p.text||"",shortText:p.shortText||"",team:p.team?.displayName||"",participants:(p.participants||[]).map(z=>z.athlete?.displayName||"").filter(Boolean)}])).values()]
  }
}
async function summary(eventId){
  const k="s:"+eventId,c=cg(k);if(c)return c;
  const raw=await json("https://site.api.espn.com/apis/site/v2/sports/soccer/all/summary?event="+eventId,12000),d=compactSummary(raw),done=!!d?.header?.event?.completed,starterCount=(d?.rosters||[]).reduce((n,r)=>n+(r.roster?.length||0),0),ttl=done?21600000:starterCount>=18?120000:180000;
  cs(k,d,ttl);return d
}
export async function marketSnapshot(eventId){
  try{const s=await summary(eventId);return {market:extractMarket(s),league:s?.header?.league||null}}catch{return {market:null,league:null}}
}
export async function eventSnapshot(eventId){
  try{
    const s=await summary(eventId),e=s?.header?.event||{},c=e.competitors||[],h=c.find(x=>x.homeAway==="home")||c[0],a=c.find(x=>x.homeAway==="away")||c[1],hb=teamBox(s,h?.id),ab=teamBox(s,a?.id);
    const stat=b=>({shots:statValue(b,"totalShots"),sot:statValue(b,"shotsOnTarget"),corners:statValue(b,"wonCorners"),saves:statValue(b,"saves"),yellows:statValue(b,"yellowCards"),reds:statValue(b,"redCards"),fouls:statValue(b,"foulsCommitted"),offsides:statValue(b,"offsides")});
    const hp=playerEventMap(s,hb?.team?.displayName||"").map(x=>({...x,side:"home"})),ap=playerEventMap(s,ab?.team?.displayName||"").map(x=>({...x,side:"away"}));
    return {eventId:String(eventId),state:e.state||"pre",completed:!!e.completed,detail:e.detail||"",homeScore:h?.score??null,awayScore:a?.score??null,homeHalf:Array.isArray(h?.linescores)&&h.linescores.length?h.linescores[0]:null,awayHalf:Array.isArray(a?.linescores)&&a.linescores.length?a.linescores[0]:null,stats:{home:stat(hb),away:stat(ab)},players:[...hp,...ap]}
  }catch(e){return {eventId:String(eventId),state:"unknown",completed:false,error:String(e?.message||e)}}
}

function statValue(teamBox,name){
  const x=(teamBox?.statistics||[]).find(s=>s.name===name);const v=Number(x?.displayValue??x?.value);
  return Number.isFinite(v)?v:null
}
function teamBox(s,teamId){return (s?.boxscore?.teams||[]).find(x=>String(x?.team?.id)===String(teamId))||null}
function starters(s,teamId){
  const r=(s?.rosters||[]).find(x=>String(x?.team?.id)===String(teamId)),a=(r?.roster||[]).filter(x=>x?.starter&&x?.athlete?.id);
  return a.map(x=>({id:String(x.athlete.id),name:x.athlete.displayName||x.athlete.fullName||"",pos:x.position?.abbreviation||x.position?.name||""}))
}
function attackIndex(own,opp){
  const sh=statValue(own,"totalShots"),sot=statValue(own,"shotsOnTarget"),pos=statValue(own,"possessionPct"),cor=statValue(own,"wonCorners"),blk=statValue(own,"blockedShots");
  const osh=statValue(opp,"totalShots"),osot=statValue(opp,"shotsOnTarget"),opos=statValue(opp,"possessionPct"),ocor=statValue(opp,"wonCorners");
  if([sh,sot,pos,cor].filter(x=>x!==null).length<3)return null;
  const attack=clamp(50+(sh-12)*1.05+(sot-4)*3.8+(cor-5)*1.05+(pos-50)*.13+((blk??4)-4)*.35,24,80);
  const defense=[osh,osot,opos,ocor].filter(x=>x!==null).length>=3?clamp(50-(osh-12)*.9-(osot-4)*3.4-(ocor-5)*.9-(opos-50)*.10,22,80):50;
  return {attack:+attack.toFixed(1),defense:+defense.toFixed(1),shots:sh,sot,poss:+pos.toFixed(1),corners:cor}
}
function teamPropRow(own,opp){
  const get=n=>statValue(own,n),oget=n=>statValue(opp,n);
  return {
    shots:get("totalShots"),sot:get("shotsOnTarget"),corners:get("wonCorners"),saves:get("saves"),
    yellows:get("yellowCards"),reds:get("redCards"),fouls:get("foulsCommitted"),offsides:get("offsides"),
    oppShots:oget("totalShots"),oppSot:oget("shotsOnTarget"),oppCorners:oget("wonCorners"),oppSaves:oget("saves"),
    oppYellows:oget("yellowCards"),oppFouls:oget("foulsCommitted"),oppOffsides:oget("offsides")
  }
}
function playerEventMap(s,teamName){
  const m=new Map();
  const pos=new Map();
  for(const r of s?.rosters||[])for(const x of r.roster||[])if(r.team?.displayName===teamName&&x?.athlete?.displayName)pos.set(x.athlete.displayName,x.position?.abbreviation||x.position?.name||"");
  const row=name=>{if(!m.has(name))m.set(name,{name,pos:pos.get(name)||"",shots:0,sot:0,goals:0,assists:0,cards:0,fouls:0,offsides:0,saves:0});return m.get(name)};
  for(const name of pos.keys())row(name);
  for(const e of s?.commentary||[]){
    const type=e.type||"",shooter=e.participants?.[0]||"",second=e.participants?.[1]||"";
    if(e.team===teamName&&shooter){
      const p=row(shooter);if(["shot-off-target","shot-blocked","shot-on-target","goal"].includes(type))p.shots++;if(["shot-on-target","goal"].includes(type))p.sot++;if(type==="goal"){p.goals++;if(second)row(second).assists++}if(["yellow-card","red-card"].includes(type))p.cards++;if(type==="foul")p.fouls++;if(type==="offside")p.offsides++
    }
    if(type==="shot-on-target"&&e.text){
      const z=e.text.match(/saved .*? by ([^(]+) \(/i);if(z?.[1])row(z[1].trim()).saves++
    }
  }
  return [...m.values()]
}
function lineupProfile(currentSummary,historical,teamId){
  const hist=historical.map(s=>starters(s,teamId)).filter(x=>x.length>=9).slice(0,3),cur=starters(currentSummary,teamId);
  const counts=new Map(),posMap=new Map();
  for(const xi of hist)for(const p of xi){counts.set(p.id,(counts.get(p.id)||0)+1);if(!posMap.has(p.id))posMap.set(p.id,p.pos)}
  const core=[...counts.entries()].filter(([,n])=>n>=2).map(([id,n])=>({id,n,pos:posMap.get(id)||""}));
  let stability=null;if(hist.length>=2){let s=0,n=0;for(let i=0;i<hist.length-1;i++){const a=new Set(hist[i].map(x=>x.id)),b=new Set(hist[i+1].map(x=>x.id)),inter=[...a].filter(x=>b.has(x)).length,uni=new Set([...a,...b]).size;s+=uni?inter/uni:0;n++}stability=n?Math.round(100*s/n):null}
  if(cur.length<9)return {available:false,stability,historyLineups:hist.length,coreCount:core.length,currentStarters:cur.length,currentIds:cur.map(x=>String(x.id)).sort()};
  const ids=new Set(cur.map(x=>x.id)),missing=core.filter(x=>!ids.has(x.id)),isAttack=p=>/FW|F|ST|CF|LW|RW|AM|W/i.test(p||""),isDef=p=>/GK|G$|CB|CD|LB|RB|DF|D-/i.test(p||"");
  return {available:true,stability,historyLineups:hist.length,coreCount:core.length,currentStarters:cur.length,currentIds:cur.map(x=>String(x.id)).sort(),missingCore:missing.length,missingAttackCore:missing.filter(x=>isAttack(x.pos)).length,missingDefCore:missing.filter(x=>isDef(x.pos)).length,missingNames:missing.slice(0,5).map(x=>x.id)}
}
async function teamAdvancedContext(events,teamId,currentSummary,depth=5){
  const chosen=(events||[]).slice(0,depth),summaries=await Promise.all(chosen.map(async e=>{try{return await summary(e.id)}catch{return null}})),rows=[],propRows=[],players=new Map();
  for(let i=0;i<summaries.length;i++){
    const s=summaries[i];if(!s)continue;const own=teamBox(s,teamId),opp=(s?.boxscore?.teams||[]).find(x=>String(x?.team?.id)!==String(teamId));if(!own||!opp)continue;
    const q=attackIndex(own,opp);if(q)rows.push({...q,_i:i});
    const pr=teamPropRow(own,opp);propRows.push({...pr,_i:i});
    const teamName=own.team?.displayName||"",w=.84**i;
    for(const p of playerEventMap(s,teamName)){
      const g=players.get(p.name)||{name:p.name,pos:p.pos||"",sample:0,sw:0,shots:0,sot:0,goals:0,assists:0,cards:0,fouls:0,offsides:0,saves:0};
      g.sample++;g.sw+=w;g.shots+=p.shots*w;g.sot+=p.sot*w;g.goals+=p.goals*w;g.assists+=p.assists*w;g.cards+=p.cards*w;g.fouls+=p.fouls*w;g.offsides+=p.offsides*w;g.saves+=p.saves*w;if(!g.pos&&p.pos)g.pos=p.pos;players.set(p.name,g)
    }
  }
  let sw=0,atk=0,def=0,shots=0,sot=0,poss=0,corners=0;rows.forEach(x=>{const w=.84**x._i;sw+=w;atk+=x.attack*w;def+=x.defense*w;shots+=x.shots*w;sot+=x.sot*w;poss+=x.poss*w;corners+=x.corners*w});
  const advanced=sw?{sample:rows.length,attack:+(atk/sw).toFixed(1),defense:+(def/sw).toFixed(1),shots:+(shots/sw).toFixed(1),sot:+(sot/sw).toFixed(1),possession:+(poss/sw).toFixed(1),corners:+(corners/sw).toFixed(1)}:{sample:0};
  const propKeys=["shots","sot","corners","saves","yellows","reds","fouls","offsides","oppShots","oppSot","oppCorners","oppSaves","oppYellows","oppFouls","oppOffsides"],props={sample:propRows.length,variance:{},trend:{}};
  for(const k of propKeys){
    let z=0,z2=0,wz=0,rz=0,rw=0;
    for(const x of propRows)if(x[k]!==null&&x[k]!==undefined){const v=Number(x[k]),w=.84**x._i;z+=v*w;z2+=v*v*w;wz+=w;if(x._i<2){rz+=v;rw++}}
    const mean=wz?z/wz:null;props[k]=mean===null?null:+mean.toFixed(2);props.variance[k]=mean===null?null:+Math.max(0,z2/wz-mean*mean).toFixed(2);props.trend[k]=rw?+(rz/rw).toFixed(2):null
  }
  const cur=starters(currentSummary,teamId),curNames=new Set(cur.map(x=>x.name)),confirmed=cur.length>=9;
  const playerRows=[...players.values()].map(g=>({name:g.name,pos:g.pos,sample:g.sample,shots:+(g.shots/g.sw).toFixed(2),sot:+(g.sot/g.sw).toFixed(2),goals:+(g.goals/g.sw).toFixed(2),assists:+(g.assists/g.sw).toFixed(2),cards:+(g.cards/g.sw).toFixed(2),fouls:+(g.fouls/g.sw).toFixed(2),offsides:+(g.offsides/g.sw).toFixed(2),saves:+(g.saves/g.sw).toFixed(2),confirmed:confirmed?curNames.has(g.name):false})).filter(x=>x.sample>=2&&(confirmed?x.confirmed:true));
  playerRows.sort((a,b)=>(b.shots+b.sot*1.4+b.goals*2+b.assists*1.3+b.saves*1.2)-(a.shots+a.sot*1.4+a.goals*2+a.assists*1.3+a.saves*1.2));
  return {advanced,props,players:{confirmedLineup:confirmed,sample:summaries.filter(Boolean).length,rows:playerRows.slice(0,12)},lineup:lineupProfile(currentSummary,summaries.filter(Boolean),teamId)}
}

async function leagueSeasonEvents(slug,seasonYear){
  if(!slug||!seasonYear)return [];
  const k="l:"+slug+":"+seasonYear,c=cg(k);if(c)return c;
  try{const d=await json("https://site.api.espn.com/apis/site/v2/sports/soccer/"+slug+"/scoreboard?dates="+seasonYear+"&limit=1000",15000),events=d.events||[];cs(k,events,21600000);return events}catch{return []}
}
function leagueRows(events,seasonYear,targetTs){
  const cutoff=Number(targetTs)||Infinity,rows=[];
  for(const e of events||[]){
    if(Number(e?.season?.year)!==Number(seasonYear)||!e?.status?.type?.completed||new Date(e.date).getTime()/1000>=cutoff)continue;
    const comp=e?.competitions?.[0],cc=comp?.competitors||[],h=cc.find(x=>x.homeAway==="home")||cc[0],a=cc.find(x=>x.homeAway==="away")||cc[1];if(!h?.id||!a?.id)continue;
    const hg=Number(h?.score?.value??h?.score)||0,ag=Number(a?.score?.value??a?.score)||0;rows.push({ts:new Date(e.date).getTime()/1000,home:String(h.id),away:String(a.id),hg,ag})
  }
  return rows.sort((a,b)=>a.ts-b.ts)
}
async function leagueEnvironment(slug,seasonYear,targetTs){
  const rows=leagueRows(await leagueSeasonEvents(slug,seasonYear),seasonYear,targetTs);
  if(rows.length<5)return {sample:rows.length};
  const n=rows.length,hg=rows.reduce((s,x)=>s+x.hg,0)/n,ag=rows.reduce((s,x)=>s+x.ag,0)/n,total=hg+ag;
  return {sample:n,avgHome:+hg.toFixed(2),avgAway:+ag.toFixed(2),avgTotal:+total.toFixed(2),over25:Math.round(100*rows.filter(x=>x.hg+x.ag>2.5).length/n),btts:Math.round(100*rows.filter(x=>x.hg>0&&x.ag>0).length/n)}
}
async function chronologicalLeagueElo(slug,seasonYear,targetTs,homeId,awayId){
  const rows=leagueRows(await leagueSeasonEvents(slug,seasonYear),seasonYear,targetTs),r=new Map(),games=new Map(),base=1500,homeAdv=55,K=24;
  const get=id=>r.get(String(id))??base,set=(id,v)=>r.set(String(id),v),inc=id=>games.set(String(id),(games.get(String(id))||0)+1);
  for(const m of rows){
    const rh=get(m.home),ra=get(m.away),eh=1/(1+10**((ra-(rh+homeAdv))/400)),ea=1-eh,sh=m.hg>m.ag?1:m.hg===m.ag?0.5:0,sa=1-sh,gd=Math.abs(m.hg-m.ag),mult=Math.min(1.75,1+Math.log1p(gd)*.22);
    set(m.home,rh+K*mult*(sh-eh));set(m.away,ra+K*mult*(sa-ea));inc(m.home);inc(m.away)
  }
  const h=String(homeId),a=String(awayId),hn=games.get(h)||0,an=games.get(a)||0;
  return {home:+get(h).toFixed(1),away:+get(a).toFixed(1),homeMatches:hn,awayMatches:an,sample:rows.length,coverage:Math.min(hn,an),scope:"league_season"}
}

export async function buildMatchContext(eventId,homeId,awayId,targetTs,homeEvents=[],awayEvents=[],source="auto"){
  let s=null,league=null;
  try{s=eventId&&source!=="sofascore"?await summary(eventId):null;league=s?.header?.league||null}catch{}
  const seasonYear=Number(s?.header?.season?.year)||new Date((Number(targetTs)||Date.now()/1000)*1000).getUTCFullYear();
  const [env,elo,global,hs,as,hx,ax]=await Promise.all([
    leagueEnvironment(league?.slug,seasonYear,targetTs),
    chronologicalLeagueElo(league?.slug,seasonYear,targetTs,homeId,awayId),
    globalEloAt(homeId,awayId,targetTs),
    opponentScheduleStrength(homeEvents,homeId,3,source),
    opponentScheduleStrength(awayEvents,awayId,3,source),
    source==="sofascore"?Promise.resolve({advanced:{sample:0},props:{sample:0,variance:{},trend:{}},players:{confirmedLineup:false,sample:0,rows:[]},lineup:{available:false,stability:null,historyLineups:0,coreCount:0,currentStarters:0,currentIds:[]}}):teamAdvancedContext(homeEvents,homeId,s,5),
    source==="sofascore"?Promise.resolve({advanced:{sample:0},props:{sample:0,variance:{},trend:{}},players:{confirmedLineup:false,sample:0,rows:[]},lineup:{available:false,stability:null,historyLineups:0,coreCount:0,currentStarters:0,currentIds:[]}}):teamAdvancedContext(awayEvents,awayId,s,5)
  ]);
  const hp=recentPower(homeEvents,homeId),ap=recentPower(awayEvents,awayId),hb=teamBox(s,homeId),ab=teamBox(s,awayId),hc=(s?.header?.event?.competitors||[]).find(x=>x.homeAway==="home"||String(x.id)===String(homeId)),ac=(s?.header?.event?.competitors||[]).find(x=>x.homeAway==="away"||String(x.id)===String(awayId));
  const hAdj=clamp(hp.rating+(hs.rating-50)*.26,24,82),aAdj=clamp(ap.rating+(as.rating-50)*.26,24,82);
  return {
    teams:{home:hb?.team?.displayName||hc?.name||"",away:ab?.team?.displayName||ac?.name||""},
    league:{id:league?.id||null,slug:league?.slug||null,name:league?.name||null,seasonYear,environment:env},
    power:{
      home:{rating:+hAdj.toFixed(1),raw:hp.rating,schedule:hs.rating,scheduleSample:hs.sample,elo:elo.home,eloMatches:elo.homeMatches,global:global.home.rating,globalCoverage:global.home.matches},
      away:{rating:+aAdj.toFixed(1),raw:ap.rating,schedule:as.rating,scheduleSample:as.sample,elo:elo.away,eloMatches:elo.awayMatches,global:global.away.rating,globalCoverage:global.away.matches},
      elo,global
    },
    advanced:{home:hx.advanced,away:ax.advanced},
    props:{home:hx.props,away:ax.props},
    players:{home:hx.players,away:ax.players},
    lineup:{home:hx.lineup,away:ax.lineup},
    market:extractMarket(s)
  }
}