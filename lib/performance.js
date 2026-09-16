import { db } from "./db.js";
import { fixtures, history, analyze } from "./core.js";
import { buildMatchContext, eventSnapshot } from "./context.js";

const MODEL="5.2",clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function sqlValue(v){
  if(v===null||v===undefined)return "NULL";
  if(typeof v==="boolean")return v?"1":"0";
  if(typeof v==="number")return Number.isFinite(v)?String(v):"NULL";
  return "'"+String(v).replaceAll("'","''")+"'"
}
function groupOf(x){
  const f=String(x?.family||"");
  if(f.startsWith("player"))return "player";
  if(f==="sot")return "shots";
  if(["cards","fouls","offsides"].includes(f))return "discipline";
  if(["result","goals","btts","combo","corners","shots","saves"].includes(f))return f;
  if(["firstHalf","teamGoals"].includes(f))return "goals";
  return f||"standard"
}
function baseFamily(key){return ["1","X","2"].includes(key)?"result":["O25","U25"].includes(key)?"goals":["BTTS","NBTTS"].includes(key)?"btts":"standard"}
function norm(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("tr").replace(/[^a-z0-9çğıöşü]+/g," ").replace(/\s+/g," ").trim()}
function thresholdFromKey(k,fam){
  const s=String(k||"");
  const map={playerShots:/_S(\d+)$/,playerSot:/_T(\d+)$/,playerFouls:/_F(\d+)$/,playerSaves:/_SV(\d+)$/};
  const m=s.match(map[fam]||/$a/);if(m)return Number(m[1]);
  if(["playerGoals","playerAssists","playerCards","playerOffsides"].includes(fam))return 1;
  return null
}
function rowsForAnalysis(analysis){
  const map=new Map();
  for(const c of analysis?.catalog?.categories||[])for(const x of c.items||[]){
    const p=Number(x.probabilityRaw??Number(x.probability||0)/100);if(!Number.isFinite(p)||p<=0||p>=1)continue;
    map.set(String(x.key),{...x,probabilityRaw:p,marketGroup:groupOf(x)})
  }
  for(const x of analysis?.markets||[]){
    const p=Number(x.probabilityRaw??Number(x.probability||0)/100);if(!Number.isFinite(p)||map.has(String(x.key)))continue;
    const family=baseFamily(x.key);map.set(String(x.key),{...x,family,probabilityRaw:p,marketGroup:groupOf({family})})
  }
  return [...map.values()]
}
export async function recordAnalysisPredictions(event,analysis,source="live"){
  if(!event?.id||!analysis)return {inserted:0};
  const rows=rowsForAnalysis(analysis).slice(0,260);if(!rows.length)return {inserted:0};
  let inserted=0;
  for(let start=0;start<rows.length;start+=120){
    const batch=rows.slice(start,start+120),values=batch.map(x=>{
      const meta={side:x.side||null,threshold:x.threshold??null,direction:x.direction||null,player:x.player||null,lineupStatus:x.lineupStatus||null,source,category:x.category||null};
      return "("+[String(event.id),String(x.key),String(analysis.modelVersion||MODEL),Number(event.startTimestamp),String(x.marketGroup||"standard"),String(x.family||""),String(x.label||x.title||x.key),Number(x.probabilityRaw),x.risk==null?null:Number(x.risk),x.marketConfidence==null?null:Number(x.marketConfidence),Number(analysis.dataQuality||0),Number(analysis.confidence||0),!!x.iddaa?.available,x.iddaa?.odd==null?null:Number(x.iddaa.odd),JSON.stringify(meta),null,null].map(sqlValue).join(",")+")"
    });
    const q=await db.query(`INSERT INTO market_prediction_history
      (event_id,market_key,model_version,match_ts,market_group,family,label,probability,risk,market_confidence,data_quality,analysis_confidence,iddaa_open,decimal_odd,metadata,result,graded_at)
      VALUES ${values.join(",")}
      ON CONFLICT (event_id,market_key,model_version) DO NOTHING`);
    inserted+=Number(q?.rowCount||0)
  }
  return {inserted,attempted:rows.length}
}
function countStat(snap,side,key){
  const h=snap?.stats?.home||{},a=snap?.stats?.away||{};
  const hv=Number(h[key]),av=Number(a[key]);
  if(side==="home")return Number.isFinite(hv)?hv:null;
  if(side==="away")return Number.isFinite(av)?av:null;
  return Number.isFinite(hv)&&Number.isFinite(av)?hv+av:null
}
function gradeRow(r,s){
  if(!s?.completed)return null;
  const k=String(r.market_key),fam=String(r.family||""),meta=typeof r.metadata==="string"?JSON.parse(r.metadata||"{}"):(r.metadata||{}),h=Number(s.homeScore),a=Number(s.awayScore),t=h+a;
  if(!Number.isFinite(h)||!Number.isFinite(a))return null;
  if(k==="1")return h>a;if(k==="X")return h===a;if(k==="2")return a>h;
  if(k==="O25")return t>=3;if(k==="U25")return t<=2;if(k==="BTTS")return h>0&&a>0;if(k==="NBTTS")return !(h>0&&a>0);
  if(k==="O15")return t>=2;if(k==="O35")return t>=4;
  if(k==="DC_1X")return h>=a;if(k==="DC_X2")return a>=h;if(k==="DC_12")return h!==a;
  const tg=k.match(/^([HA])_TG([012])5$/);if(tg){const g=tg[1]==="H"?h:a,thr=Number(tg[2])+1;return g>=thr}
  if(k.startsWith("FH_")){
    const hh=Number(s.homeHalf),ha=Number(s.awayHalf);if(!Number.isFinite(hh)||!Number.isFinite(ha))return null;const ft=hh+ha;
    if(k==="FH_1")return hh>ha;if(k==="FH_X")return hh===ha;if(k==="FH_2")return ha>hh;if(k==="FH_O05")return ft>=1;if(k==="FH_U05")return ft===0;if(k==="FH_O15")return ft>=2;if(k==="FH_BTTS")return hh>0&&ha>0;if(k==="FH_H05")return hh>=1;if(k==="FH_A05")return ha>=1
  }
  if(k==="C_1_BTTS")return h>a&&h>0&&a>0;if(k==="C_2_BTTS")return a>h&&h>0&&a>0;if(k==="C_1_NBTTS")return h>a&&!(h>0&&a>0);if(k==="C_2_NBTTS")return a>h&&!(h>0&&a>0);
  if(k==="C_1_O15")return h>a&&t>=2;if(k==="C_2_O15")return a>h&&t>=2;if(k==="C_1_O25")return h>a&&t>=3;if(k==="C_2_O25")return a>h&&t>=3;if(k==="C_1_U35")return h>a&&t<=3;if(k==="C_2_U35")return a>h&&t<=3;
  if(k==="C_1X_BTTS")return h>=a&&h>0&&a>0;if(k==="C_X2_BTTS")return a>=h&&h>0&&a>0;if(k==="C_1X_O15")return h>=a&&t>=2;if(k==="C_X2_O15")return a>=h&&t>=2;if(k==="C_1X_O25")return h>=a&&t>=3;if(k==="C_X2_O25")return a>=h&&t>=3;if(k==="C_BTTS_O25")return h>0&&a>0&&t>=3;
  const statMap={corners:"corners",shots:"shots",sot:"sot",cards:"yellows",fouls:"fouls",offsides:"offsides",saves:"saves"};
  if(statMap[fam]){
    const val=countStat(s,meta.side||"match",statMap[fam]),thr=Number(meta.threshold),dir=meta.direction||"over";if(val==null||!Number.isFinite(thr))return null;
    return dir==="under"?val<thr:val>=thr
  }
  if(fam.startsWith("player")){
    const name=norm(meta.player),p=(s.players||[]).find(x=>norm(x.name)===name||(name&&norm(x.name).includes(name))||(norm(x.name)&&name.includes(norm(x.name))));if(!p)return null;
    const field={playerShots:"shots",playerSot:"sot",playerGoals:"goals",playerAssists:"assists",playerCards:"cards",playerFouls:"fouls",playerOffsides:"offsides",playerSaves:"saves"}[fam];if(!field)return null;
    const v=Number(p[field]),thr=Number(meta.threshold??thresholdFromKey(k,fam));if(!Number.isFinite(v)||!Number.isFinite(thr))return null;return v>=thr
  }
  return null
}
async function gradeEvent(eventId,snap){
  const q=await db.query("SELECT event_id,market_key,model_version,family,metadata FROM market_prediction_history WHERE event_id=$1 AND model_version=$2 AND result IS NULL",[String(eventId),MODEL]);
  const graded=[];for(const r of q.rows||[]){const g=gradeRow(r,snap);if(g===null)continue;graded.push({key:String(r.market_key),result:!!g})}
  if(!graded.length)return 0;
  for(let start=0;start<graded.length;start+=160){
    const batch=graded.slice(start,start+160),cases=batch.map(x=>"WHEN "+sqlValue(x.key)+" THEN "+(x.result?"1":"0")).join(" "),keys=batch.map(x=>sqlValue(x.key)).join(",");
    await db.query(`UPDATE market_prediction_history SET result=CASE market_key ${cases} ELSE result END,graded_at=CURRENT_TIMESTAMP WHERE event_id=${sqlValue(String(eventId))} AND model_version=${sqlValue(MODEL)} AND result IS NULL AND market_key IN (${keys})`)
  }
  return graded.length
}
async function mapLimit(items,limit,fn){const out=new Array(items.length);let next=0;async function w(){while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch{out[i]=0}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>w()));return out}
export async function gradePendingPredictions(limitEvents=30){
  const q=await db.query("SELECT DISTINCT event_id,match_ts FROM market_prediction_history WHERE model_version=$1 AND result IS NULL AND match_ts < $2 ORDER BY match_ts ASC LIMIT $3",[MODEL,Math.floor(Date.now()/1000)-5400,Math.max(1,Math.min(80,limitEvents))]);
  const ids=(q.rows||[]).map(x=>String(x.event_id));if(!ids.length)return {events:0,graded:0};
  const n=await mapLimit(ids,5,async id=>{const s=await eventSnapshot(id);return s?.completed?gradeEvent(id,s):0});
  return {events:ids.length,graded:n.reduce((a,x)=>a+Number(x||0),0)}
}
export async function marketPerformanceSummary(){
  const q=await db.query(`WITH per_event AS (
      SELECT event_id,market_group,
        count(*)::int AS rows_n,
        avg(CASE WHEN result THEN 1.0 ELSE 0.0 END) AS hit_rate,
        avg(probability) AS avg_prob,
        avg((probability-(CASE WHEN result THEN 1.0 ELSE 0.0 END))*(probability-(CASE WHEN result THEN 1.0 ELSE 0.0 END))) AS brier,
        avg(probability*(1-probability)) AS expected_brier
      FROM market_prediction_history
      WHERE model_version=$1 AND result IS NOT NULL AND match_ts >= $2
      GROUP BY event_id,market_group
    )
    SELECT market_group,sum(rows_n)::int AS n,count(*)::int AS event_n,
      avg(hit_rate) AS hit_rate,avg(avg_prob) AS avg_prob,avg(brier) AS brier,avg(expected_brier) AS expected_brier
    FROM per_event GROUP BY market_group ORDER BY n DESC`,[MODEL,Math.floor(Date.now()/1000)-120*86400]);
  const groups=(q.rows||[]).map(r=>{
    const n=Number(r.n||0),eventN=Number(r.event_n||0),hit=Number(r.hit_rate||0),avg=Number(r.avg_prob||0),brier=Number(r.brier||0),exp=Math.max(.0001,Number(r.expected_brier||0)),gap=Math.abs(hit-avg),ratio=brier/exp;
    let status="Veri az",adjustment=0;if(eventN>=25){if(gap<=.055&&ratio<=1.18){status="Tutarlı";adjustment=5}else if(gap<=.10&&ratio<=1.40){status="İzleniyor";adjustment=0}else{status="Zayıf uyum";adjustment=-7}}
    return {group:String(r.market_group),n,eventN,hitRate:+(hit*100).toFixed(1),avgModel:+(avg*100).toFixed(1),calibrationGap:+(gap*100).toFixed(1),brier:+brier.toFixed(4),status,adjustment}
  });
  return {modelVersion:MODEL,groups,byGroup:Object.fromEntries(groups.map(x=>[x.group,x])),resolved:groups.reduce((a,x)=>a+x.n,0)}
}
export function applyPerformanceToAnalysis(analysis,summary){
  return {...analysis,marketPerformance:summary?.byGroup||{}}
}
export async function backfillPerformanceDate(date,{limit=8}={}){
  const f=await fixtures(date),matches=(f.events||[]).filter(e=>e.status?.type==="finished").sort((a,b)=>a.startTimestamp-b.startTimestamp).slice(0,Math.max(1,Math.min(12,limit)));
  const rows=await mapLimit(matches,2,async e=>{
    const [hh,aa]=await Promise.all([history(e.homeTeam.id,e.startTimestamp,10,e.dataSource||"auto"),history(e.awayTeam.id,e.startTimestamp,10,e.dataSource||"auto")]);if((hh.events?.length||0)<5||(aa.events?.length||0)<5)return {skip:true};
    const ctx=await buildMatchContext(String(e.id),e.homeTeam.id,e.awayTeam.id,e.startTimestamp,hh.events,aa.events,e.dataSource||"auto"),a=analyze(e.homeTeam.id,e.awayTeam.id,hh.events,aa.events,e.startTimestamp,ctx);
    await recordAnalysisPredictions(e,a,"backfill");const snap=await eventSnapshot(String(e.id));const graded=snap?.completed?await gradeEvent(String(e.id),snap):0;return {eventId:String(e.id),graded}
  });
  return {date,total:matches.length,processed:rows.filter(x=>x&&!x.skip).length,graded:rows.reduce((a,x)=>a+Number(x?.graded||0),0)}
}
function ymd(d){return d.toISOString().slice(0,10)}
export async function backfillPerformanceRange(from,{days=5,perDay=4}={}){
  const start=new Date(from+"T12:00:00Z"),out=[];for(let i=0;i<Math.max(1,Math.min(8,days));i++){const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);out.push(await backfillPerformanceDate(ymd(d),{limit:Math.max(1,Math.min(6,perDay))}))}
  return {from,days:out.length,processed:out.reduce((n,x)=>n+Number(x.processed||0),0),graded:out.reduce((n,x)=>n+Number(x.graded||0),0),results:out}
}