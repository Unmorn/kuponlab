import { db } from "./db.js";
import { fixtures } from "./core.js";

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const score=(e,s)=>Number(e?.[s+"Score"]?.normaltime??e?.[s+"Score"]?.current??0)||0;
function expected(a,b,homeAdv=48){return 1/(1+10**((b-(a+homeAdv))/400))}
function update(rh,ra,hg,ag){
  const eh=expected(rh,ra),sh=hg>ag?1:hg===ag?.5:0,gd=Math.abs(hg-ag),mult=Math.min(1.8,1+Math.log1p(gd)*.20),K=20;
  return [rh+K*mult*(sh-eh),ra+K*mult*((1-sh)-(1-eh))]
}
async function mapLimit(items,limit,fn){const out=new Array(items.length);let n=0;async function w(){while(true){const i=n++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch{out[i]=null}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>w()));return out}

function sqlValue(v){
  if(v===null||v===undefined)return "NULL";
  if(typeof v==="number")return Number.isFinite(v)?String(v):"NULL";
  return "'"+String(v).replaceAll("'","''")+"'"
}

async function selectInChunks(prefix,ids){
  const rows=[];
  for(let start=0;start<ids.length;start+=90){
    const batch=ids.slice(start,start+90),marks=batch.map((_,i)=>"$"+(i+1)).join(",");
    const q=await db.query(prefix+"("+marks+")",batch);rows.push(...(q.rows||[]));
  }
  return rows
}
async function processEvents(input,label="range"){
  const events=[...new Map((input||[]).filter(e=>e?.status?.type==="finished").map(e=>[String(e.id),e])).values()].sort((a,b)=>a.startTimestamp-b.startTimestamp);
  if(!events.length)return {label,events:0,processed:0,teams:0};
  const ids=events.map(e=>String(e.id)),doneRows=await selectInChunks("SELECT event_id FROM global_elo_matches WHERE event_id IN ",ids),seen=new Set(doneRows.map(x=>String(x.event_id))),todo=events.filter(e=>!seen.has(String(e.id)));
  if(!todo.length)return {label,events:events.length,processed:0,teams:0};
  const teamIds=[...new Set(todo.flatMap(e=>[String(e.homeTeam.id),String(e.awayTeam.id)]))],teamRowsExisting=await selectInChunks("SELECT team_id,team_name,rating,matches,last_ts FROM global_team_elo WHERE team_id IN ",teamIds),ratings=new Map(teamRowsExisting.map(x=>[String(x.team_id),{rating:Number(x.rating||1500),matches:Number(x.matches||0),lastTs:Number(x.last_ts||0),name:x.team_name||""}]));
  const get=(id,name)=>{id=String(id);if(!ratings.has(id))ratings.set(id,{rating:1500,matches:0,lastTs:0,name:name||""});return ratings.get(id)};
  const rows=[];
  for(const e of todo){
    const h=get(e.homeTeam.id,e.homeTeam.name),a=get(e.awayTeam.id,e.awayTeam.name),hg=score(e,"home"),ag=score(e,"away"),preH=h.rating,preA=a.rating,[postH,postA]=update(preH,preA,hg,ag);
    h.rating=postH;h.matches++;h.lastTs=e.startTimestamp;h.name=e.homeTeam.name||h.name;a.rating=postA;a.matches++;a.lastTs=e.startTimestamp;a.name=e.awayTeam.name||a.name;
    rows.push({eventId:String(e.id),ts:e.startTimestamp,homeId:String(e.homeTeam.id),awayId:String(e.awayTeam.id),homeName:e.homeTeam.name||"",awayName:e.awayTeam.name||"",competition:e.tournament?.uniqueTournament?.name||e.tournament?.name||"",hg,ag,preH,preA,postH,postA,hm:h.matches,am:a.matches})
  }
  for(let start=0;start<rows.length;start+=180){
    const batch=rows.slice(start,start+180),vals=batch.map(r=>"("+[r.eventId,r.ts,r.homeId,r.awayId,r.homeName,r.awayName,r.competition,r.hg,r.ag,r.preH,r.preA,r.postH,r.postA,r.hm,r.am].map(sqlValue).join(",")+")").join(",");
    await db.query(`INSERT INTO global_elo_matches(event_id,match_ts,home_id,away_id,home_name,away_name,competition,home_goals,away_goals,pre_home_rating,pre_away_rating,post_home_rating,post_away_rating,home_matches_after,away_matches_after) VALUES ${vals} ON CONFLICT(event_id) DO NOTHING`)
  }
  const teamRows=[...ratings.entries()].filter(([id])=>teamIds.includes(id));
  for(let start=0;start<teamRows.length;start+=300){
    const batch=teamRows.slice(start,start+300),vals=batch.map(([id,x])=>"("+[id,x.name,+x.rating.toFixed(3),x.matches,x.lastTs].map(sqlValue).join(",")+")").join(",");
    await db.query(`INSERT INTO global_team_elo(team_id,team_name,rating,matches,last_ts) VALUES ${vals} ON CONFLICT(team_id) DO UPDATE SET team_name=EXCLUDED.team_name,rating=EXCLUDED.rating,matches=EXCLUDED.matches,last_ts=EXCLUDED.last_ts,updated_at=CURRENT_TIMESTAMP`)
  }
  return {label,events:events.length,processed:rows.length,teams:teamRows.length}
}
export async function processGlobalEloDate(date,{maxEvents=900}={}){
  const f=await fixtures(date);return {date,...await processEvents((f.events||[]).slice(0,maxEvents),date)}
}
export async function globalEloAt(homeId,awayId,targetTs){
  try{
    const h=String(homeId),a=String(awayId),q=await db.query(`SELECT match_ts,home_id,away_id,post_home_rating,post_away_rating,home_matches_after,away_matches_after
      FROM global_elo_matches
      WHERE (home_id=$1 OR away_id=$1 OR home_id=$2 OR away_id=$2) AND match_ts<$3
      ORDER BY match_ts DESC LIMIT 240`,[h,a,Number(targetTs)]),rows=q.rows||[];
    const find=id=>{
      for(const r of rows){
        if(String(r.home_id)===id)return {rating:Number(r.post_home_rating||1500),matches:Number(r.home_matches_after||0)};
        if(String(r.away_id)===id)return {rating:Number(r.post_away_rating||1500),matches:Number(r.away_matches_after||0)}
      }
      return {rating:1500,matches:0}
    };
    const hr=find(h),ar=find(a),coverage=Math.min(hr.matches,ar.matches),edge=clamp((hr.rating-ar.rating)/260,-1,1);
    return {home:hr,away:ar,coverage,edge:+edge.toFixed(4),method:"persistent_global_elo",scope:"all_competitions_chronological"}
  }catch{return {home:{rating:1500,matches:0},away:{rating:1500,matches:0},coverage:0,edge:0,method:"unavailable",scope:"all_competitions_chronological"}}
}
export async function resetGlobalElo(){await db.transaction([{sql:"DELETE FROM global_elo_matches",params:[]},{sql:"DELETE FROM global_team_elo",params:[]}]);return {reset:true}}
function ymd(d){return d.toISOString().slice(0,10)}
export async function processGlobalEloRange(from,days,{reset=false,maxEvents=900}={}){
  if(reset)await resetGlobalElo();const start=new Date(from+"T12:00:00Z"),dates=[];for(let i=0;i<Math.max(1,Math.min(50,days));i++){const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);dates.push(ymd(d))}
  const packs=await mapLimit(dates,6,async date=>{const f=await fixtures(date);return (f.events||[]).slice(0,maxEvents)}),events=packs.flatMap(x=>x||[]),run=await processEvents(events,from+"+"+dates.length);
  return {from,days:dates.length,processed:run.processed,events:run.events,teams:run.teams}
}