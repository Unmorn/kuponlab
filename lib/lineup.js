import { db } from "./db.js";
import { fixtures, history, analyze } from "./core.js";
import { buildMatchContext } from "./context.js";
import { loadCalibration, applyCalibration } from "./backtest.js";

const MODEL="5.2";
const pmap=a=>new Map((a?.markets||[]).map(x=>[String(x.key),Number(x.probabilityRaw??Number(x.probability||0)/100)]));
function lineupState(analysis){
  const h=analysis?.context?.lineup?.home||{},a=analysis?.context?.lineup?.away||{},hc=!!h.available,ac=!!a.available;
  const ids=[...(h.currentIds||[]).map(x=>"H"+x),...(a.currentIds||[]).map(x=>"A"+x)].sort();
  return {homeConfirmed:hc,awayConfirmed:ac,kind:hc&&ac?"confirmed":"pre",hash:hc&&ac?(ids.join("-")||"confirmed"):"pre",home:h,away:a}
}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
export async function attachLineupImpact(eventId,matchTs,analysis){
  if(!eventId||!analysis)return analysis;
  try{
    const s=lineupState(analysis),m=pmap(analysis),meta={home:s.home,away:s.away};
    await db.query(`INSERT INTO match_analysis_snapshots
      (event_id,model_version,snapshot_kind,lineup_hash,match_ts,home_confirmed,away_confirmed,p_home,p_draw,p_away,p_over25,p_btts,xg_home,xg_away,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
      ON CONFLICT (event_id,model_version,snapshot_kind,lineup_hash) DO NOTHING`,[
      String(eventId),String(analysis.modelVersion||MODEL),s.kind,s.hash,Number(matchTs||0),s.homeConfirmed,s.awayConfirmed,
      num(m.get("1")),num(m.get("X")),num(m.get("2")),num(m.get("O25")),num(m.get("BTTS")),num(analysis.expectedGoals?.home),num(analysis.expectedGoals?.away),JSON.stringify(meta)
    ]);
    const q=await db.query(`SELECT snapshot_kind,lineup_hash,p_home,p_draw,p_away,p_over25,p_btts,xg_home,xg_away,created_at
      FROM match_analysis_snapshots WHERE event_id=$1 AND model_version=$2 ORDER BY created_at ASC`,[String(eventId),String(analysis.modelVersion||MODEL)]);
    const rows=q.rows||[],base=rows.find(x=>x.snapshot_kind==="pre"),cur=rows.filter(x=>x.snapshot_kind==="confirmed").at(-1);
    if(!s.homeConfirmed&&!s.awayConfirmed)return {...analysis,lineupImpact:{state:"waiting",homeConfirmed:false,awayConfirmed:false,baselineStored:!!base}};
    if(!(s.homeConfirmed&&s.awayConfirmed))return {...analysis,lineupImpact:{state:"partial",homeConfirmed:s.homeConfirmed,awayConfirmed:s.awayConfirmed,baselineStored:!!base}};
    if(!base)return {...analysis,lineupImpact:{state:"confirmed",homeConfirmed:true,awayConfirmed:true,baselineStored:false}};
    const now={p_home:num(m.get("1")),p_draw:num(m.get("X")),p_away:num(m.get("2")),p_over25:num(m.get("O25")),p_btts:num(m.get("BTTS")),xg_home:num(analysis.expectedGoals?.home),xg_away:num(analysis.expectedGoals?.away)};
    const delta=(k)=>now[k]==null||base[k]==null?null:+((now[k]-Number(base[k]))*(k.startsWith("p_")?100:1)).toFixed(k.startsWith("p_")?1:2);
    const changes={home:delta("p_home"),draw:delta("p_draw"),away:delta("p_away"),over25:delta("p_over25"),btts:delta("p_btts"),xgHome:delta("xg_home"),xgAway:delta("xg_away")};
    const max=Math.max(...Object.values(changes).filter(x=>Number.isFinite(x)).map(Math.abs),0);
    return {...analysis,lineupImpact:{state:"confirmed",homeConfirmed:true,awayConfirmed:true,baselineStored:true,changed:max>=1,changes,baselineAt:base.created_at,currentAt:cur?.created_at||new Date().toISOString(),missing:{homeAttack:Number(s.home.missingAttackCore||0),homeDef:Number(s.home.missingDefCore||0),awayAttack:Number(s.away.missingAttackCore||0),awayDef:Number(s.away.missingDefCore||0)}}}
  }catch{return analysis}
}
function ymd(d){return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0")+"-"+String(d.getUTCDate()).padStart(2,"0")}
async function mapLimit(items,limit,fn){const out=new Array(items.length);let n=0;async function w(){while(true){const i=n++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch(e){out[i]={error:String(e?.message||e)}}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>w()));return out}
export async function scanUpcomingLineups({minutes=180,limit=12}={}){
  const now=Math.floor(Date.now()/1000),d0=new Date(),d1=new Date(Date.now()+86400000),[a,b]=await Promise.all([fixtures(ymd(d0)),fixtures(ymd(d1))]);
  const seen=new Set(),events=[...(a.events||[]),...(b.events||[])].filter(e=>{const id=String(e.id);if(seen.has(id))return false;seen.add(id);return e.startTimestamp>=now-900&&e.startTimestamp<=now+Math.max(60,minutes)*60}).sort((x,y)=>x.startTimestamp-y.startTimestamp).slice(0,Math.max(1,limit));
  const cal=await loadCalibration();
  const rows=await mapLimit(events,2,async e=>{
    const [hh,aa]=await Promise.all([history(e.homeTeam.id,e.startTimestamp,10),history(e.awayTeam.id,e.startTimestamp,10)]);
    if((hh.events?.length||0)<4||(aa.events?.length||0)<4)return {eventId:String(e.id),skip:"history"};
    const ctx=await buildMatchContext(String(e.id),e.homeTeam.id,e.awayTeam.id,e.startTimestamp,hh.events,aa.events),raw=analyze(e.homeTeam.id,e.awayTeam.id,hh.events,aa.events,e.startTimestamp,ctx),analysis=applyCalibration(raw,cal.rows),withImpact=await attachLineupImpact(String(e.id),e.startTimestamp,analysis);
    return {eventId:String(e.id),match:e.homeTeam.name+" - "+e.awayTeam.name,startTimestamp:e.startTimestamp,state:withImpact.lineupImpact?.state||"unknown",impact:withImpact.lineupImpact||null}
  });
  return {checked:events.length,rows}
}