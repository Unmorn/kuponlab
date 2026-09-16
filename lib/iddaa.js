import { db } from "./db.js";
const BASE="https://sportsbookv2.iddaa.com";
const cache=new Map();
const headers={"origin":"https://www.iddaa.com","referer":"https://www.iddaa.com/","user-agent":"Mozilla/5.0","accept":"application/json, text/plain, */*"};

const getCache=k=>{const x=cache.get(k);return x&&x.e>Date.now()?x.v:null};
const setCache=(k,v,ms)=>{cache.set(k,{v,e:Date.now()+ms});return v};
function sqlValue(v){
  if(v===null||v===undefined)return "NULL";
  if(typeof v==="boolean")return v?"1":"0";
  if(typeof v==="number")return Number.isFinite(v)?String(v):"NULL";
  return "'"+String(v).replaceAll("'","''")+"'"
}

async function getJson(url,ms=10000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);
  try{const r=await fetch(url,{headers,signal:c.signal});if(!r.ok)throw new Error("HTTP "+r.status);return await r.json()}finally{clearTimeout(t)}
}

export async function iddaaEvents(){
  const k="events",c=getCache(k);if(c)return c;
  const d=await getJson(BASE+"/sportsbook/events?st=1&type=0&version=0",12000);
  const rows=d?.isSuccess?(d?.data?.events||[]):[];
  return setCache(k,rows,45000)
}

export async function marketConfig(){
  const k="config",c=getCache(k);if(c)return c;
  const d=await getJson(BASE+"/sportsbook/get_market_config",12000);
  const rows=d?.isSuccess?(d?.data?.m||{}):{};
  return setCache(k,rows,6*60*60*1000)
}

function norm(s){
  return String(s||"").toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\b(fc|cf|sc|fk|sk|ac|afc|club|deportivo|calcio|spor|futbol|football|the)\b/g," ")
    .replace(/[^a-z0-9çğıöşü]+/gi," ").replace(/\s+/g," ").trim()
}
function sim(a,b){
  a=norm(a);b=norm(b);if(!a||!b)return 0;if(a===b)return 1;
  const A=new Set(a.split(" ")),B=new Set(b.split(" "));let inter=0;for(const x of A)if(B.has(x))inter++;
  const jac=inter/Math.max(1,new Set([...A,...B]).size),inc=(a.includes(b)||b.includes(a))?.30:0;
  return Math.min(1,jac+inc)
}

export async function matchIddaaEvent(event){
  if(!event)return null;
  const home=event?.homeTeam?.name||event?.homeTeam?.displayName||event?.home||"",away=event?.awayTeam?.name||event?.awayTeam?.displayName||event?.away||"",ts=Number(event?.startTimestamp||event?.ts||0);
  if(!home||!away||!ts)return null;
  let best=null;
  for(const x of await iddaaEvents()){
    const td=Math.abs(Number(x.d||0)-ts);if(td>5400)continue;
    const direct=(sim(home,x.hn)+sim(away,x.an))/2,reverse=(sim(home,x.an)+sim(away,x.hn))/2;
    const score=Math.max(direct,reverse)-Math.min(td/5400,.20);
    if(!best||score>best.score)best={event:x,score,direct,reverse,timeDiff:td,reversed:reverse>direct}
  }
  if(!best||best.score<.50||best.reversed)return null;
  return {...best,eventId:String(best.event.i),homeName:best.event.hn,awayName:best.event.an,startTimestamp:Number(best.event.d),marketCount:(best.event.m||[]).length}
}

export async function iddaaEventDetail(id){
  const k="detail:"+id,c=getCache(k);if(c)return c;
  const d=await getJson(BASE+"/sportsbook/event/"+encodeURIComponent(id),10000);
  return setCache(k,d?.isSuccess?d.data:null,30000)
}

function fmtName(tpl,m){
  return String(tpl||("Market "+m.st)).replaceAll("{0}",String(m.sov??"")).replaceAll("{h}",String(m.sov??""))
}
export async function enrichMarkets(detail){
  if(!detail)return [];
  const cfg=await marketConfig(),out=[];
  for(const m of detail.m||[]){
    const c=cfg[String(m.t)+"_"+String(m.st)]||null,name=fmtName(c?.n,m);
    for(const o of m.o||[])out.push({
      marketId:String(m.i),marketType:Number(m.t),subType:Number(m.st),marketVersion:Number(m.v||0),eventVersion:Number(detail.v||0),marketName:name,marketDescription:c?.d||null,line:m.sov??null,
      outcomeNo:Number(o.no),outcomeName:String(o.n||""),odd:Number(o.odd||0)||null,secondaryOdd:Number(o.wodd||0)||null,mbs:Number(m.mbc||detail.mbc||0)||null,status:Number(m.s??0),eventId:String(detail.i)
    })
  }
  return out
}

const outcome=(rows,mt,st,line,name)=>rows.find(x=>x.marketType===mt&&x.subType===st&&(line==null||String(x.line)===String(line))&&String(x.outcomeName).toLocaleLowerCase("tr")===String(name).toLocaleLowerCase("tr"));
const keyNorm=s=>String(s||"").toLocaleLowerCase("tr").replaceAll("ı","i").replaceAll("İ","i").normalize("NFD").replace(/[\u0300-\u036f]/g,"");

function simpleOfficialMap(rows,key){
  if(key==="1")return outcome(rows,1,1,null,"1");
  if(key==="X")return outcome(rows,1,1,null,"0");
  if(key==="2")return outcome(rows,1,1,null,"2");
  if(key==="O25")return outcome(rows,2,101,"2.5","Üst");
  if(key==="U25")return outcome(rows,2,101,"2.5","Alt");
  if(key==="BTTS")return outcome(rows,2,89,null,"Var");
  if(key==="NBTTS")return outcome(rows,2,89,null,"Yok");
  if(key==="TG01")return rows.find(x=>x.marketType===2&&x.subType===4&&keyNorm(x.outcomeName).includes("0-1"));
  if(key==="TG23")return rows.find(x=>x.marketType===2&&x.subType===4&&keyNorm(x.outcomeName).includes("2-3"));
  if(key==="TG45")return rows.find(x=>x.marketType===2&&x.subType===4&&keyNorm(x.outcomeName).includes("4-5"));
  if(key==="TG6P")return rows.find(x=>x.marketType===2&&x.subType===4&&keyNorm(x.outcomeName).includes("6+"));
  if(key.startsWith("HTFT_")){const z=key.split("_"),n=(z[1]==="X"?"0":z[1])+"/"+(z[2]==="X"?"0":z[2]);return outcome(rows,2,90,null,n)}
  if(key.startsWith("CS_")){const z=key.split("_"),n=z[1]+":"+z[2];return rows.find(x=>x.marketType===2&&x.subType===86&&x.outcomeName===n)}
  return null
}

function ouFind(rows,terms,line,direction){
  const dir=direction==="under"?"alt":"ust",ln=Number(line);
  return rows.find(x=>{
    const n=keyNorm(x.marketName),o=keyNorm(x.outcomeName),l=Number(x.line);
    return terms.every(t=>n.includes(t))&&Number.isFinite(l)&&Math.abs(l-(ln-.5))<.01&&o===dir
  })
}
function teamCountFind(rows,terms,threshold,direction){
  const dir=direction==="under"?"alt":"ust";
  return rows.find(x=>{
    const n=keyNorm(x.marketName),o=keyNorm(x.outcomeName),line=Number(x.line);
    return terms.every(t=>n.includes(t))&&Number.isFinite(line)&&Math.abs(line-(Number(threshold)-.5))<.01&&o===dir
  })
}
function comboFind(rows,key){
  const map={
    C_1_BTTS:["1 ve Var"],C_2_BTTS:["2 ve Var"],C_1_NBTTS:["1 ve Yok"],C_2_NBTTS:["2 ve Yok"]
  };
  if(map[key])return rows.find(x=>x.marketType===2&&x.subType===698&&map[key].includes(x.outcomeName));
  const z=key.match(/^C_(1|2)_(O|U)(15|25|35)$/);if(z){
    const line={15:"1.5",25:"2.5",35:"3.5"}[z[3]],word=z[2]==="O"?"Üst":"Alt";
    return rows.find(x=>x.marketType===2&&x.subType===7&&String(x.line)===line&&x.outcomeName===z[1]+" ve "+word)
  }
  return null
}
function playerFind(rows,item){
  if(!item?.player)return null;const pn=keyNorm(item.player),family=String(item.family||""),threshold=Number(item.threshold||String(item.key||"").match(/(?:S|T|SV|F)(\d+)$/)?.[1]||1);
  const familyTerms=family==="playerShots"?["sut"]:family==="playerSot"?["kaleyi bulan","sut"]:family==="playerSaves"?["kurtaris"]:family==="playerFouls"?["faul"]:family==="playerCards"?["kart"]:family==="playerOffsides"?["ofsayt"]:family==="playerGoals"?["gol"]:family==="playerAssists"?["asist"]:[];
  if(!familyTerms.length)return null;
  return rows.find(x=>{
    const mn=keyNorm(x.marketName),on=keyNorm(x.outcomeName),m=String(x.outcomeName||"").match(/(?:^|\s)(\d+)\+\s*$/),n=m?Number(m[1]):null;
    const nameOk=on.includes(pn)||pn.includes(on.replace(/\s+\d+\+\s*$/,""));
    const thresholdOk=["playerCards","playerGoals","playerAssists","playerOffsides"].includes(family)?true:(Number.isFinite(n)&&n===threshold);
    return familyTerms.every(t=>mn.includes(t))&&nameOk&&thresholdOk
  })
}

function closeName(a,b){a=keyNorm(a);b=keyNorm(b);return !!a&&!!b&&(a===b||a.includes(b)||b.includes(a))}
function plusFind(rows,subType,who,threshold){
  const wn=keyNorm(who),th=Number(threshold);
  return rows.find(x=>{
    if(x.marketType!==2||x.subType!==subType)return false;
    const raw=String(x.outcomeName||""),m=raw.match(/^(.*?)\s+(\d+)\+\s*$/),n=m?Number(m[2]):null;
    return !!wn&&!!m&&closeName(m[1],wn)&&Number.isFinite(n)&&n===th
  })
}
export function mapOfficialOdd(rows,item,teams={}){
  if(!item)return null;
  let r=simpleOfficialMap(rows,item.key)||comboFind(rows,item.key);
  const k=String(item.key||""),dir=item.direction|| (k.includes("_U")?"under":"over");
  const th=Number(item.threshold||k.match(/(\d+)$/)?.[1]||0);
  if(!r&&k==="DC_1X")r=outcome(rows,2,92,null,"1 ve 0");
  if(!r&&k==="DC_X2")r=outcome(rows,2,92,null,"0 ve 2");
  if(!r&&k==="DC_12")r=outcome(rows,2,92,null,"1 ve 2");
  if(!r&&k==="O15")r=outcome(rows,2,101,"1.5","Üst");
  if(!r&&k==="O35")r=outcome(rows,2,101,"3.5","Üst");
  if(!r&&k==="H_TG05")r=outcome(rows,2,603,"0.5","Üst");
  if(!r&&k==="H_TG15")r=outcome(rows,2,603,"1.5","Üst");
  if(!r&&k==="H_TG25")r=outcome(rows,2,603,"2.5","Üst");
  if(!r&&k==="A_TG05")r=outcome(rows,2,604,"0.5","Üst");
  if(!r&&k==="A_TG15")r=outcome(rows,2,604,"1.5","Üst");
  if(!r&&k==="A_TG25")r=outcome(rows,2,604,"2.5","Üst");
  if(!r&&k==="FH_1")r=outcome(rows,2,88,null,"1");
  if(!r&&k==="FH_X")r=outcome(rows,2,88,null,"0");
  if(!r&&k==="FH_2")r=outcome(rows,2,88,null,"2");
  if(!r&&k==="FH_O05")r=outcome(rows,2,60,"0.5","Üst");
  if(!r&&k==="FH_U05")r=outcome(rows,2,60,"0.5","Alt");
  if(!r&&k==="FH_O15")r=outcome(rows,2,60,"1.5","Üst");
  if(!r&&k==="FH_BTTS")r=outcome(rows,2,720,null,"Var");
  if(!r&&k==="FH_H05")r=outcome(rows,2,722,"0.5","Üst");
  if(!r&&k==="FH_A05")r=outcome(rows,2,723,"0.5","Üst");
  if(!r&&k.startsWith("HC_"))r=teamCountFind(rows,["ev sahibi","korner"],th,dir);
  if(!r&&k.startsWith("AC_"))r=teamCountFind(rows,["deplasman","korner"],th,dir);
  if(!r&&k.startsWith("TC_"))r=teamCountFind(rows,["toplam","korner"],th,dir)||teamCountFind(rows,["korner sayisi"],th,dir);
  if(!r&&k.startsWith("HS_")&&!k.startsWith("HS_U")&&dir==="over")r=plusFind(rows,912,teams.home||"",th);
  if(!r&&k.startsWith("AS_")&&!k.startsWith("AS_U")&&dir==="over")r=plusFind(rows,912,teams.away||"",th);
  if(!r&&k.startsWith("TS_")&&!k.startsWith("TS_U")&&dir==="over")r=plusFind(rows,912,"Toplam",th);
  if(!r&&k.startsWith("HT_")&&!k.startsWith("HT_U")&&dir==="over")r=plusFind(rows,913,teams.home||"",th);
  if(!r&&k.startsWith("AT_")&&!k.startsWith("AT_U")&&dir==="over")r=plusFind(rows,913,teams.away||"",th);
  if(!r&&k.startsWith("TT_")&&!k.startsWith("TT_U")&&dir==="over")r=plusFind(rows,913,"Toplam",th);
  if(!r&&k.startsWith("HO_")&&!k.startsWith("HO_U")&&dir==="over")r=plusFind(rows,915,teams.home||"",th);
  if(!r&&k.startsWith("AO_")&&!k.startsWith("AO_U")&&dir==="over")r=plusFind(rows,915,teams.away||"",th);
  if(!r&&k.startsWith("TO_")&&!k.startsWith("TO_U")&&dir==="over")r=plusFind(rows,915,"Toplam",th);
  if(!r&&k.startsWith("YC_"))r=ouFind(rows,["toplam","kart"],th,dir);
  if(!r&&item.player)r=playerFind(rows,item);
  return r?{decimal:r.odd,secondaryDecimal:r.secondaryOdd,marketId:r.marketId,marketName:r.marketName,outcomeNo:r.outcomeNo,outcomeName:r.outcomeName,line:r.line,mbs:r.mbs,source:"iddaa",iddaaEventId:r.eventId}:null
}

export async function officialSnapshot(event){
  try{
    const match=await matchIddaaEvent(event);if(!match)return {available:false,matched:false,reason:"not_in_iddaa_program"};
    const detail=await iddaaEventDetail(match.eventId),markets=await enrichMarkets(detail);
    return {available:!!detail,matched:true,match:{eventId:match.eventId,home:match.homeName,away:match.awayName,startTimestamp:match.startTimestamp,score:+match.score.toFixed(3),timeDiff:match.timeDiff,mbs:Number(detail?.mbc||0)||null},markets,checkedAt:Date.now()}
  }catch(e){return {available:false,matched:false,reason:"iddaa_fetch_error",error:String(e?.message||e)}}
}
function officialOddMeta(rows,mapped,defaultMbs=null){
  if(!mapped?.decimal)return null;
  const exclusive=new Set(["1_1","2_101","2_60","2_89","2_88","2_4","2_7","2_698","2_700","2_603","2_604","2_658","2_48","2_822","2_823"]);
  const row=rows.find(x=>String(x.marketId)===String(mapped.marketId)&&String(x.outcomeName)===String(mapped.outcomeName)),code=row?row.marketType+"_"+row.subType:"";
  let fairProbability=null;
  if(row&&exclusive.has(code)){
    const group=rows.filter(x=>String(x.marketId)===String(row.marketId)&&Number(x.odd)>1),sum=group.reduce((s,x)=>s+1/Number(x.odd),0);
    if(group.length>=2&&sum>0)fairProbability=+(1/Number(row.odd)/sum).toFixed(5)
  }
  return {available:true,eventId:Number(mapped.iddaaEventId),marketId:Number(mapped.marketId),marketName:mapped.marketName,outcomeNo:Number(row?.outcomeNo??mapped.outcomeNo)||null,outcomeName:mapped.outcomeName,odd:+Number(mapped.decimal).toFixed(2),webOdd:null,secondaryOdd:Number(mapped.secondaryDecimal)>1?+Number(mapped.secondaryDecimal).toFixed(2):null,mbs:Number(mapped.mbs||defaultMbs||0)||null,line:mapped.line??null,fairProbability,rawImplied:+(1/Number(mapped.decimal)).toFixed(5),source:"iddaa_public"}
}
function poiP(k,l){let p=Math.exp(-l);for(let i=1;i<=k;i++)p*=l/i;return p}
function modelCountGE(mean,k,variance=null){
  mean=Math.max(.05,Number(mean)||.05);const v=Number(variance);
  if(!Number.isFinite(v)||v<=mean*1.08){let s=0;for(let i=0;i<k;i++)s+=poiP(i,mean);return Math.max(.001,Math.min(.999,1-s))}
  const rr=Math.max(.35,mean*mean/Math.max(.05,v-mean)),pp=rr/(rr+mean);let pm=Math.exp(rr*Math.log(pp)),sum=pm;
  for(let i=1;i<k;i++){pm*=((i-1+rr)/i)*(1-pp);sum+=pm}
  return Math.max(.001,Math.min(.999,1-sum))
}
const fairOdds=p=>p>0?+(1/p).toFixed(2):null;
const modelRisk=p=>Math.round(Math.max(18,Math.min(96,96-p*82)));
function dynamicConf(mean,v,sample){
  const cv=Number.isFinite(Number(v))&&mean>0?Math.sqrt(Math.max(0,Number(v)))/mean:.75;
  return Math.round(Math.max(35,Math.min(84,38+Number(sample||0)*7-cv*10)))
}
function dynamicIddaaMeta(rows,row,defaultMbs){
  return officialOddMeta(rows,{decimal:row.odd,secondaryDecimal:row.secondaryOdd,marketId:row.marketId,marketName:row.marketName,outcomeNo:row.outcomeNo,outcomeName:row.outcomeName,line:row.line,mbs:row.mbs,iddaaEventId:row.eventId},defaultMbs)
}
function playerSideAndRow(analysis,name){
  const n=keyNorm(name);for(const side of ["home","away"])for(const p of analysis?.context?.players?.[side]?.rows||[])if(keyNorm(p.name)===n||keyNorm(p.name).includes(n)||n.includes(keyNorm(p.name)))return {side,p};
  return null
}
function dynamicActualItems(analysis,snap,home,away){
  const out=[],l=analysis?.catalog?.lambdas||{},props=analysis?.context?.props||{},sample=Number(analysis?.catalog?.propsSample||0),rows=snap?.markets||[];
  const variance=(side,key,total=false)=>{
    if(total){const a=Number(props?.home?.variance?.[key]),b=Number(props?.away?.variance?.[key]);return Number.isFinite(a)&&Number.isFinite(b)?a+b:null}
    const v=Number(props?.[side]?.variance?.[key]);return Number.isFinite(v)?v:null
  };
  const add=(category,key,label,title,p,row,family,side,lambda,v,extra={})=>{
    if(!row||!(Number(row.odd)>1))return;const iddaa=dynamicIddaaMeta(rows,row,snap.match?.mbs),mc=dynamicConf(lambda,v,sample);
    out.push({category,key,label,title,probability:Math.round(p*100),probabilityRaw:+p.toFixed(5),fairOdds:fairOdds(p),risk:modelRisk(p),sample,family,side,lambda:+Number(lambda).toFixed(2),variance:v==null?null:+Number(v).toFixed(2),marketConfidence:mc,model:"prop_v2_actual_line",direction:"over",actualLine:true,iddaa,...extra})
  };
  const parsePlus=s=>{const m=String(s||"").match(/^(.*?)\s+(\d+)\+$/);return m?{who:m[1].trim(),n:Number(m[2])}:null};
  for(const row of rows){
    const st=Number(row.subType),plus=parsePlus(row.outcomeName);
    if(st===912&&plus){
      const wn=keyNorm(plus.who);let side="match",lambda=Number(l.hShots||0)+Number(l.aShots||0),v=variance("home","shots",true),prefix="TS_",label="Toplam "+plus.n+"+ şut";
      if(closeName(wn,home)){side="home";lambda=Number(l.hShots);v=variance("home","shots");prefix="HS_";label=home+" "+plus.n+"+ şut"}
      else if(closeName(wn,away)){side="away";lambda=Number(l.aShots);v=variance("away","shots");prefix="AS_";label=away+" "+plus.n+"+ şut"}
      else if(wn!=="toplam")continue;
      add("shots",prefix+plus.n,label,label,modelCountGE(lambda,plus.n,v),row,"shots",side,lambda,v)
    }else if(st===913&&plus){
      const wn=keyNorm(plus.who);let side="match",lambda=Number(l.hSot||0)+Number(l.aSot||0),v=variance("home","sot",true),prefix="TT_",label="Toplam "+plus.n+"+ isabetli şut";
      if(closeName(wn,home)){side="home";lambda=Number(l.hSot);v=variance("home","sot");prefix="HT_";label=home+" "+plus.n+"+ isabetli şut"}
      else if(closeName(wn,away)){side="away";lambda=Number(l.aSot);v=variance("away","sot");prefix="AT_";label=away+" "+plus.n+"+ isabetli şut"}
      else if(wn!=="toplam")continue;
      add("shots",prefix+plus.n,label,label,modelCountGE(lambda,plus.n,v),row,"sot",side,lambda,v)
    }else if(st===915&&plus){
      const wn=keyNorm(plus.who);let side="match",lambda=Number(l.hOff||0)+Number(l.aOff||0),v=variance("home","offsides",true),prefix="TO_",label="Toplam "+plus.n+"+ ofsayt";
      if(closeName(wn,home)){side="home";lambda=Number(l.hOff);v=variance("home","offsides");prefix="HO_";label=home+" "+plus.n+"+ ofsayt"}
      else if(closeName(wn,away)){side="away";lambda=Number(l.aOff);v=variance("away","offsides");prefix="AO_";label=away+" "+plus.n+"+ ofsayt"}
      else if(wn!=="toplam")continue;
      add("discipline",prefix+plus.n,label,label,modelCountGE(lambda,plus.n,v),row,"offsides",side,lambda,v)
    }else if(st===890&&plus&&keyNorm(plus.who)!=="toplam"){
      const pr=playerSideAndRow(analysis,plus.who);if(!pr||!(Number(pr.p.saves)>.05))continue;
      const lambda=Number(pr.p.saves),tag=(pr.side==="home"?"H":"A")+"P_"+pr.p.name.replace(/[^\p{L}\p{N}]+/gu,"_").slice(0,32),p=modelCountGE(lambda,plus.n,null);
      add("players",tag+"_SV"+plus.n,pr.p.name+" "+plus.n+"+ kurtarış",pr.p.name+" "+plus.n+"+ kaleci kurtarışı",p,row,"playerSaves",pr.side,lambda,null,{player:pr.p.name,pos:pr.p.pos,lineupStatus:analysis?.context?.players?.[pr.side]?.confirmedLineup?"İlk 11 onaylı":"Muhtemel"})
    }
  }
  for(const row of rows){
    const st=Number(row.subType),line=Number(row.line),dir=keyNorm(row.outcomeName)==="alt"?"under":keyNorm(row.outcomeName)==="ust"?"over":null;if(!dir||!Number.isFinite(line))continue;
    const n=Math.round(line+.5);let category=null,prefix=null,labelBase=null,family=null,side="match",lambda=null,v=null;
    if(st===48){category="corners";prefix="TC_";labelBase="Toplam korner";family="corners";lambda=Number(l.hCorners||0)+Number(l.aCorners||0);v=variance("home","corners",true)}
    else if(st===822){category="corners";prefix="HC_";labelBase="Ev korner";family="corners";side="home";lambda=Number(l.hCorners);v=variance("home","corners")}
    else if(st===823){category="corners";prefix="AC_";labelBase="Dep korner";family="corners";side="away";lambda=Number(l.aCorners);v=variance("away","corners")}
    else if(st===658){category="discipline";prefix="YC_";labelBase="Toplam sarı kart";family="cards";lambda=Number(l.hCards||0)+Number(l.aCards||0);v=variance("home","yellows",true)}
    if(!category||!(lambda>0))continue;const over=modelCountGE(lambda,n,v),p=dir==="over"?over:1-over,key=prefix+(dir==="under"?"U":"")+n;
    add(category,key,labelBase+" "+line+" "+(dir==="over"?"ÜST":"ALT"),labelBase+" "+line+" "+(dir==="over"?"Üst":"Alt"),p,row,family,side,lambda,v);out[out.length-1].direction=dir;out[out.length-1].threshold=n
  }
  return out
}
function movementGroup(x){
  const k=String(x?.key||""),f=String(x?.family||"");if(["1","X","2","DC_1X","DC_X2","DC_12"].includes(k))return "result";if(["BTTS","NBTTS"].includes(k)||f==="btts")return "goals";if(f.startsWith("player"))return "player";if(f==="sot")return "shots";if(["cards","fouls","offsides"].includes(f))return "discipline";if(["corners","shots","saves","combo","goals","result"].includes(f))return f;if(f==="firstHalf"||f==="teamGoals")return "goals";return "standard"
}
async function attachOddsMovement(eventId,categories,exotic,meta={}){
  try{
    const refs=[],seen=new Set();
    const add=x=>{const i=x?.iddaa;if(!i?.available||!(Number(i.odd)>1)||!i.marketId||!i.outcomeName)return;const k=i.marketId+"|"+i.outcomeName;if(seen.has(k))return;seen.add(k);refs.push({i,x})};
    for(const c of categories||[])for(const x of c.items||[])add(x);
    if(exotic)for(const x of [...(exotic.goals||[]),...(exotic.htft||[]),...(exotic.scorelines||[])])add(x);
    if(!refs.length)return {count:0};
    const rows=refs.slice(0,120),map=new Map();
    for(let start=0;start<rows.length;start+=80){
      const batch=rows.slice(start,start+80),vals=batch.map(({i,x})=>"("+[
        Number(eventId),Number(i.marketId),String(i.outcomeName),Number(i.odd),Number(i.odd),Number(i.odd),Number(i.odd),
        String(meta.matchName||""),Number(meta.matchTs||0)||null,String(i.marketName||""),String(x.key||""),movementGroup(x),
        Number(x.probabilityRaw??Number(x.probability||0)/100)||null,i.fairProbability==null?null:Number(i.fairProbability),x.risk==null?null:Number(x.risk)
      ].map(sqlValue).join(",")+")").join(",");
      const q=await db.query(`INSERT INTO iddaa_odds_history
        (event_id,market_id,outcome_name,first_odd,last_odd,min_odd,max_odd,match_name,match_ts,market_name,market_key,market_group,model_probability,fair_probability,risk)
        VALUES ${vals}
        ON CONFLICT (event_id,market_id,outcome_name) DO UPDATE SET
          last_odd=EXCLUDED.last_odd,
          min_odd=MIN(iddaa_odds_history.min_odd,EXCLUDED.last_odd),
          max_odd=MAX(iddaa_odds_history.max_odd,EXCLUDED.last_odd),
          match_name=COALESCE(NULLIF(EXCLUDED.match_name,''),iddaa_odds_history.match_name),
          match_ts=COALESCE(EXCLUDED.match_ts,iddaa_odds_history.match_ts),
          market_name=COALESCE(NULLIF(EXCLUDED.market_name,''),iddaa_odds_history.market_name),
          market_key=COALESCE(NULLIF(EXCLUDED.market_key,''),iddaa_odds_history.market_key),
          market_group=COALESCE(NULLIF(EXCLUDED.market_group,''),iddaa_odds_history.market_group),
          model_probability=COALESCE(EXCLUDED.model_probability,iddaa_odds_history.model_probability),
          fair_probability=COALESCE(EXCLUDED.fair_probability,iddaa_odds_history.fair_probability),
          risk=COALESCE(EXCLUDED.risk,iddaa_odds_history.risk),
          last_seen_at=CURRENT_TIMESTAMP,
          change_count=iddaa_odds_history.change_count+CASE WHEN iddaa_odds_history.last_odd <> EXCLUDED.last_odd THEN 1 ELSE 0 END
        RETURNING event_id,market_id,outcome_name,first_odd,last_odd,min_odd,max_odd,first_seen_at,last_seen_at,change_count`);
      for(const x of q.rows||[])map.set(String(x.market_id)+"|"+x.outcome_name,x)
    }
    const enrich=x=>{const i=x?.iddaa;if(!i?.available)return;const h=map.get(String(i.marketId)+"|"+i.outcomeName);if(!h)return;const first=Number(h.first_odd),last=Number(h.last_odd),pct=first>0?((last-first)/first)*100:0;i.movement={firstOdd:+first.toFixed(2),currentOdd:+last.toFixed(2),minOdd:+Number(h.min_odd).toFixed(2),maxOdd:+Number(h.max_odd).toFixed(2),changePct:+pct.toFixed(1),changeCount:Number(h.change_count||0),firstSeenAt:h.first_seen_at,lastSeenAt:h.last_seen_at}};
    for(const c of categories||[])for(const x of c.items||[])enrich(x);
    if(exotic)for(const x of [...(exotic.goals||[]),...(exotic.htft||[]),...(exotic.scorelines||[])])enrich(x);
    return {count:map.size}
  }catch{return {count:0}}
}
export async function enrichWithIddaa(analysis,home,away,targetTs,{trackOdds=true}={}){
  const event={homeTeam:{name:home},awayTeam:{name:away},startTimestamp:Number(targetTs)};
  const snap=await officialSnapshot(event);
  if(!snap?.matched||!snap?.available)return {...analysis,iddaa:{matched:false,source:"iddaa_public",reason:snap?.reason||"not_in_iddaa_program"}};
  const teams={home,away},mapItem=x=>{
    const mapped=mapOfficialOdd(snap.markets,x,teams),iddaa=officialOddMeta(snap.markets,mapped,snap.match?.mbs);
    return {...x,iddaa}
  };
  const markets=(analysis?.markets||[]).map(mapItem),categories=(analysis?.catalog?.categories||[]).map(c=>({...c,items:(c.items||[]).map(mapItem)})),dynamic=dynamicActualItems(analysis,snap,home,away);
  for(const d of dynamic){
    const cat=categories.find(c=>c.id===d.category);if(!cat)continue;const i=cat.items.findIndex(x=>x.key===d.key);
    if(i>=0)cat.items[i]={...cat.items[i],...d,iddaa:d.iddaa};else cat.items.push(d)
  }
  const exotic=analysis?.exotic?{
    goals:(analysis.exotic.goals||[]).map(mapItem),
    htft:(analysis.exotic.htft||[]).map(mapItem),
    scorelines:(analysis.exotic.scorelines||[]).map(mapItem)
  }:analysis?.exotic;
  const movement=trackOdds?await attachOddsMovement(Number(snap.match.eventId),categories,exotic,{matchName:home+" - "+away,matchTs:Number(targetTs)}):{count:0};
  const mappedCount=categories.reduce((s,c)=>s+c.items.filter(x=>x.iddaa?.available).length,0)+(exotic?[...exotic.goals,...exotic.htft,...exotic.scorelines].filter(x=>x.iddaa?.available).length:0);
  return {...analysis,markets,catalog:{...analysis.catalog,categories},exotic,iddaa:{matched:true,eventId:Number(snap.match.eventId),home:snap.match.home,away:snap.match.away,startTimestamp:snap.match.startTimestamp,mbs:snap.match.mbs,matchScore:snap.match.score,availableMappedMarkets:mappedCount,dynamicActualLines:dynamic.length,trackedOdds:movement.count,totalMarkets:new Set(snap.markets.map(x=>x.marketId)).size,source:"iddaa_public",checkedAt:snap.checkedAt}}
}
export async function iddaaMatchSnapshot(home,away,targetTs){
  try{
    const match=await matchIddaaEvent({homeTeam:{name:home},awayTeam:{name:away},startTimestamp:Number(targetTs)});
    if(!match)return {matched:false,market:null};
    return {matched:true,eventId:Number(match.eventId),matchScore:+Number(match.score).toFixed(3),market:{provider:"İddaa",mbs:Number(match.event?.mbc||0)||null}}
  }catch{return {matched:false,market:null}}
}
async function smallMapLimit(items,limit,fn){const out=new Array(items.length);let n=0;async function w(){while(true){const i=n++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch{out[i]=0}}}await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>w()));return out}
export async function refreshOddsHistory(limitEvents=24){
  try{
    const q=await db.query(`SELECT DISTINCT event_id FROM iddaa_odds_history
      WHERE (match_ts IS NULL OR match_ts > $1) AND last_seen_at > datetime('now','-36 hours')
      ORDER BY event_id LIMIT $2`,[Math.floor(Date.now()/1000)-900,Math.max(1,Math.min(24,limitEvents))]),ids=(q.rows||[]).map(x=>Number(x.event_id));
    const counts=await smallMapLimit(ids,4,async eventId=>{
      const [tracked,detail]=await Promise.all([db.query("SELECT market_id,outcome_name,last_odd FROM iddaa_odds_history WHERE event_id=$1",[eventId]),iddaaEventDetail(eventId)]),live=await enrichMarkets(detail),map=new Map(live.map(x=>[String(x.marketId)+"|"+x.outcomeName,x])),rows=[];
      for(const r of tracked.rows||[]){const x=map.get(String(r.market_id)+"|"+r.outcome_name);if(!x||!(Number(x.odd)>1))continue;rows.push({marketId:Number(r.market_id),outcomeName:String(r.outcome_name),odd:Number(x.odd)})}
      if(!rows.length)return 0;
      let updated=0;
      for(let start=0;start<rows.length;start+=100){
        const batch=rows.slice(start,start+100),vals=batch.map(x=>"("+[eventId,x.marketId,x.outcomeName,x.odd,x.odd,x.odd,x.odd].map(sqlValue).join(",")+")").join(",");
        const z=await db.query(`INSERT INTO iddaa_odds_history(event_id,market_id,outcome_name,first_odd,last_odd,min_odd,max_odd)
          VALUES ${vals}
          ON CONFLICT(event_id,market_id,outcome_name) DO UPDATE SET
            last_odd=EXCLUDED.last_odd,
            min_odd=MIN(iddaa_odds_history.min_odd,EXCLUDED.last_odd),
            max_odd=MAX(iddaa_odds_history.max_odd,EXCLUDED.last_odd),
            last_seen_at=CURRENT_TIMESTAMP,
            change_count=iddaa_odds_history.change_count+CASE WHEN iddaa_odds_history.last_odd <> EXCLUDED.last_odd THEN 1 ELSE 0 END`);
        updated+=Number(z?.rowCount||batch.length)
      }
      return updated
    });
    return {events:ids.length,updated:counts.reduce((a,x)=>a+Number(x||0),0)}
  }catch(e){return {events:0,updated:0,error:String(e?.message||e)}}
}
