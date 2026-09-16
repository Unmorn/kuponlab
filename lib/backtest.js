import { db } from "./db.js";
import { fixtures, history, analyze } from "./core.js";
import { buildMatchContext } from "./context.js";

const ACTIVE_MODEL="5.2",clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function sqlValue(v){
  if(v===null||v===undefined)return "NULL";
  if(typeof v==="boolean")return v?"1":"0";
  if(typeof v==="number")return Number.isFinite(v)?String(v):"NULL";
  return "'"+String(v).replaceAll("'","''")+"'"
}
const score=(e,s)=>Number(e?.[s+"Score"]?.normaltime??e?.[s+"Score"]?.current??0)||0;
const prob=(a,key)=>{const m=a.markets.find(x=>x.key===key);return Number(m?.probabilityRaw??(m?.probability||0)/100)||0};
const isoDate=d=>d.toISOString().slice(0,10);

async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i],i)}catch(e){out[i]={ok:false,error:String(e?.message||e)}}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));return out
}

export async function runBacktestDate(date,{limit=20}={}){
  const f=await fixtures(date);
  const matches=(f.events||[]).filter(e=>e.status?.type==="finished").sort((a,b)=>a.startTimestamp-b.startTimestamp).slice(0,Math.max(1,Math.min(40,limit)));
  const results=await mapLimit(matches,2,async e=>{
    const [hh,aa]=await Promise.all([history(e.homeTeam.id,e.startTimestamp,10,e.dataSource||"auto"),history(e.awayTeam.id,e.startTimestamp,10,e.dataSource||"auto")]);
    if((hh.events?.length||0)<5||(aa.events?.length||0)<5)return {ok:false,skip:"history",eventId:String(e.id)};
    const context=await buildMatchContext(String(e.id),e.homeTeam.id,e.awayTeam.id,e.startTimestamp,hh.events,aa.events,e.dataSource||"auto");
    const a=analyze(e.homeTeam.id,e.awayTeam.id,hh.events,aa.events,e.startTimestamp,context),hg=score(e,"home"),ag=score(e,"away");
    return {ok:true,eventId:String(e.id),best:a.bestPick?.key,confidence:a.confidence,row:[String(e.id),e.startTimestamp,String(e.homeTeam.id),String(e.awayTeam.id),hg,ag,prob(a,"1"),prob(a,"X"),prob(a,"2"),prob(a,"O25"),prob(a,"BTTS"),a.dataQuality,a.confidence,a.modelVersion]}
  });
  const good=results.filter(x=>x?.ok&&x.row);
  if(good.length){
    const values=good.map(x=>"("+x.row.map(sqlValue).join(",")+")").join(",");
    await db.query(`INSERT INTO model_backtest_predictions
      (event_id,match_ts,home_id,away_id,home_goals,away_goals,p_home,p_draw,p_away,p_over25,p_btts,data_quality,confidence,model_version)
      VALUES ${values}
      ON CONFLICT (event_id,model_version) DO UPDATE SET
      match_ts=EXCLUDED.match_ts,home_id=EXCLUDED.home_id,away_id=EXCLUDED.away_id,
      home_goals=EXCLUDED.home_goals,away_goals=EXCLUDED.away_goals,
      p_home=EXCLUDED.p_home,p_draw=EXCLUDED.p_draw,p_away=EXCLUDED.p_away,
      p_over25=EXCLUDED.p_over25,p_btts=EXCLUDED.p_btts,
      data_quality=EXCLUDED.data_quality,confidence=EXCLUDED.confidence,
      model_version=EXCLUDED.model_version,created_at=CURRENT_TIMESTAMP`)
  }
  return {date,total:matches.length,processed:good.length,skipped:results.length-good.length}
}

function observations(r){
  const hg=Number(r.home_goals),ag=Number(r.away_goals),over=hg+ag>2.5,btts=hg>0&&ag>0;
  return {
    "1":[Number(r.p_home),hg>ag?1:0],
    "X":[Number(r.p_draw),hg===ag?1:0],
    "2":[Number(r.p_away),hg<ag?1:0],
    "O25":[Number(r.p_over25),over?1:0],
    "U25":[1-Number(r.p_over25),over?0:1],
    "BTTS":[Number(r.p_btts),btts?1:0],
    "NBTTS":[1-Number(r.p_btts),btts?0:1]
  }
}

export async function recomputeCalibration(version=ACTIVE_MODEL){
  const q=await db.query(`SELECT event_id,home_goals,away_goals,p_home,p_draw,p_away,p_over25,p_btts,data_quality,confidence,model_version
    FROM model_backtest_predictions WHERE model_version=$1 ORDER BY match_ts DESC LIMIT 2500`,[version]);
  const rows=q.rows||[],groups=new Map(),metric=new Map();
  for(const r of rows)for(const [market,[p0,y]] of Object.entries(observations(r))){
    const p=clamp(p0,.001,.999),bucket=Math.min(4,Math.floor(p*5))*20,k=market+":"+bucket;
    const g=groups.get(k)||{market,bucket,n:0,sp:0,sy:0};g.n++;g.sp+=p;g.sy+=y;groups.set(k,g);
    const m=metric.get(market)||{n:0,brier:0};m.n++;m.brier+=(p-y)*(p-y);metric.set(market,m)
  }
  const gs=[...groups.values()];
  await db.query("DELETE FROM model_calibration WHERE model_version=$1",[version]);
  if(gs.length){
    const values=gs.map(g=>"("+[version,g.market,g.bucket,g.sp/g.n,g.sy/g.n,g.n].map(sqlValue).join(",")+",CURRENT_TIMESTAMP)").join(",");
    await db.query(`INSERT INTO model_calibration (model_version,market,bucket,predicted_avg,observed_rate,sample_count,updated_at)
      VALUES ${values}
      ON CONFLICT (model_version,market,bucket) DO UPDATE SET
      predicted_avg=EXCLUDED.predicted_avg,observed_rate=EXCLUDED.observed_rate,
      sample_count=EXCLUDED.sample_count,updated_at=CURRENT_TIMESTAMP`)
  }
  calCache=null;calCacheAt=0;
  return {version,matches:rows.length,markets:[...metric.entries()].map(([market,m])=>({market,n:m.n,brier:+(m.brier/m.n).toFixed(4)}))}
}

let calCache=null,calCacheAt=0;
export async function loadCalibration(version=ACTIVE_MODEL){
  if(calCache?.version===version&&Date.now()-calCacheAt<600000)return calCache;
  try{
    const [q,c]=await Promise.all([
      db.query("SELECT market,bucket,predicted_avg,observed_rate,sample_count FROM model_calibration WHERE model_version=$1",[version]),
      db.query("SELECT count(*)::int AS n FROM model_backtest_predictions WHERE model_version=$1",[version])
    ]);
    const total=Number(c.rows?.[0]?.n||0);calCache={version,rows:total>=40?(q.rows||[]):[],total};calCacheAt=Date.now();return calCache
  }catch{return {version,rows:[],total:0}}
}

export function applyCalibration(analysis,rows=[]){
  if(!analysis||!rows.length)return {...analysis,calibrated:false,calibrationMarkets:0};
  const map=new Map(rows.map(r=>[r.market+":"+Number(r.bucket),r])), raw={};
  for(const m of analysis.markets){
    const p=clamp(Number(m.probabilityRaw??m.probability/100),.001,.999),bucket=Math.min(4,Math.floor(p*5))*20,r=map.get(m.key+":"+bucket);
    let adj=p;
    if(r&&Number(r.sample_count)>=12){
      const w=Math.min(.62,Number(r.sample_count)/90),delta=Number(r.observed_rate)-Number(r.predicted_avg);
      adj=clamp(p+delta*w,.03,.97)
    }
    raw[m.key]=adj
  }
  const norm=keys=>{const s=keys.reduce((a,k)=>a+(raw[k]||0),0)||1;keys.forEach(k=>raw[k]=(raw[k]||0)/s)};
  norm(["1","X","2"]);norm(["O25","U25"]);norm(["BTTS","NBTTS"]);
  const markets=analysis.markets.map(m=>({...m,probabilityRaw:+raw[m.key].toFixed(5),probability:Math.round(raw[m.key]*100)}));
  const bestPick=[...markets].sort((a,b)=>b.probability-a.probability)[0],evidence=markets.filter(m=>{const p=Number(m.probabilityRaw),b=Math.min(4,Math.floor(p*5))*20,r=map.get(m.key+":"+b);return r&&Number(r.sample_count)>=12}).length;
  const quality=Number(analysis.dataQuality||50),derived=clamp(42+Math.abs(bestPick.probability-50)*1.15+quality*.11,42,88),confidence=Math.round(.6*Number(analysis.confidence||50)+.4*derived);
  const signal=confidence>=74&&bestPick.probability>=60?"Güçlü":confidence>=62&&bestPick.probability>=55?"Orta":"Zayıf";
  return {...analysis,markets,bestPick,confidence,signal,calibrated:evidence>0,calibrationMarkets:evidence}
}

function logLoss(p,y){p=clamp(Number(p),.001,.999);return -(y*Math.log(p)+(1-y)*Math.log(1-p))}
function trainCal(rows){
  const g=new Map();
  for(const r of rows)for(const [market,[p0,y]] of Object.entries(observations(r))){const p=clamp(p0,.001,.999),bucket=Math.min(4,Math.floor(p*5))*20,k=market+":"+bucket,x=g.get(k)||{n:0,sp:0,sy:0};x.n++;x.sp+=p;x.sy+=y;g.set(k,x)}
  return g
}
function calOne(market,p,map){
  p=clamp(Number(p),.001,.999);const bucket=Math.min(4,Math.floor(p*5))*20,g=map.get(market+":"+bucket);if(!g||g.n<8)return p;
  const w=Math.min(.58,g.n/80);return clamp(p+(g.sy/g.n-g.sp/g.n)*w,.02,.98)
}
function metricPack(rows,calMap,base){
  let mb=0,mll=0,ob=0,oll=0,bb=0,bll=0,bmb=0,bmll=0,bob=0,boll=0,bbb=0,bbll=0;
  for(const r of rows){
    const hg=Number(r.home_goals),ag=Number(r.away_goals),y=[hg>ag?1:0,hg===ag?1:0,hg<ag?1:0],raw=[Number(r.p_home),Number(r.p_draw),Number(r.p_away)],adj=[calOne("1",raw[0],calMap),calOne("X",raw[1],calMap),calOne("2",raw[2],calMap)],s=adj.reduce((a,x)=>a+x,0)||1;for(let i=0;i<3;i++)adj[i]/=s;
    mb+=adj.reduce((z,p,i)=>z+(p-y[i])**2,0);mll-=Math.log(clamp(adj[y.indexOf(1)],.001,.999));
    bmb+=base.oneXTwo.reduce((z,p,i)=>z+(p-y[i])**2,0);bmll-=Math.log(clamp(base.oneXTwo[y.indexOf(1)],.001,.999));
    const yo=hg+ag>2.5?1:0,po=calOne("O25",Number(r.p_over25),calMap),yb=hg>0&&ag>0?1:0,pb=calOne("BTTS",Number(r.p_btts),calMap);
    ob+=(po-yo)**2;oll+=logLoss(po,yo);bb+=(pb-yb)**2;bll+=logLoss(pb,yb);
    bob+=(base.over25-yo)**2;boll+=logLoss(base.over25,yo);bbb+=(base.btts-yb)**2;bbll+=logLoss(base.btts,yb)
  }
  const n=Math.max(1,rows.length),f=x=>+((x||0)/n).toFixed(4);
  return {matches:rows.length,oneXTwo:{brier:f(mb),logLoss:f(mll),baselineBrier:f(bmb),baselineLogLoss:f(bmll)},over25:{brier:f(ob),logLoss:f(oll),baselineBrier:f(bob),baselineLogLoss:f(boll)},btts:{brier:f(bb),logLoss:f(bll),baselineBrier:f(bbb),baselineLogLoss:f(bbll)}}
}
export async function validationReport(version=ACTIVE_MODEL){
  const q=await db.query(`SELECT event_id,match_ts,home_goals,away_goals,p_home,p_draw,p_away,p_over25,p_btts,data_quality,confidence,model_version
    FROM model_backtest_predictions WHERE model_version=$1 ORDER BY match_ts ASC`,[version]),rows=q.rows||[];
  if(rows.length<24)return {version,status:"collecting",matches:rows.length,minRecommended:100,message:"Kronolojik holdout için veri toplanıyor."};
  const cut=Math.max(18,Math.floor(rows.length*.75)),train=rows.slice(0,cut),validation=rows.slice(cut),wins=train.filter(r=>Number(r.home_goals)>Number(r.away_goals)).length,draws=train.filter(r=>Number(r.home_goals)===Number(r.away_goals)).length,aways=train.length-wins-draws;
  const base={oneXTwo:[wins/train.length,draws/train.length,aways/train.length],over25:train.filter(r=>Number(r.home_goals)+Number(r.away_goals)>2.5).length/train.length,btts:train.filter(r=>Number(r.home_goals)>0&&Number(r.away_goals)>0).length/train.length},cal=trainCal(train),metrics=metricPack(validation,cal,base);
  return {version,status:"holdout",matches:rows.length,train:{n:train.length,from:Number(train[0]?.match_ts||0),to:Number(train.at(-1)?.match_ts||0)},validation:{n:validation.length,from:Number(validation[0]?.match_ts||0),to:Number(validation.at(-1)?.match_ts||0)},metrics,notes:["Kronolojik %75 train / %25 validation","Kalibrasyon yalnızca train bölümünden öğrenildi","1X2 Brier: üç sınıf kare hata toplamının maç başına ortalaması"]}
}
export async function matchedVersionReport(a="4.0",b=ACTIVE_MODEL){
  const q=await db.query(`SELECT a.event_id,a.match_ts,a.home_goals,a.away_goals,
    a.p_home AS a_home,a.p_draw AS a_draw,a.p_away AS a_away,a.p_over25 AS a_over,a.p_btts AS a_btts,
    b.p_home AS b_home,b.p_draw AS b_draw,b.p_away AS b_away,b.p_over25 AS b_over,b.p_btts AS b_btts
    FROM model_backtest_predictions a JOIN model_backtest_predictions b ON a.event_id=b.event_id
    WHERE a.model_version=$1 AND b.model_version=$2 ORDER BY a.match_ts ASC`,[a,b]);
  const rows=q.rows||[];if(!rows.length)return {a,b,matches:0,status:"collecting"};
  const conv=(r,p)=>({home_goals:r.home_goals,away_goals:r.away_goals,p_home:r[p+"_home"],p_draw:r[p+"_draw"],p_away:r[p+"_away"],p_over25:r[p+"_over"],p_btts:r[p+"_btts"]}),base={oneXTwo:[1/3,1/3,1/3],over25:.5,btts:.5},empty=new Map();
  return {a,b,matches:rows.length,status:"matched",aMetrics:metricPack(rows.map(r=>conv(r,"a")),empty,base),bMetrics:metricPack(rows.map(r=>conv(r,"b")),empty,base)}
}
export function dateDaysAgo(days){
  const d=new Date();d.setUTCDate(d.getUTCDate()-days);return isoDate(d)
}