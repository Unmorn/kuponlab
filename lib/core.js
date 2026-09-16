const cache=new Map();
const now=()=>Date.now();
function cg(k){const x=cache.get(k);if(!x||x.e<now()){cache.delete(k);return null}return x.v}
function cs(k,v,ttl){cache.set(k,{v,e:now()+ttl})}
async function getJson(url,timeout=12000,headers={}){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
  try{
    const r=await fetch(url,{signal:c.signal,redirect:"follow",headers:{accept:"application/json,text/plain,*/*",...headers}});
    if(!r.ok){const body=await r.text().catch(()=>"");throw new Error("HTTP "+r.status+(body?" · "+body.slice(0,120):""))}
    return await r.json()
  }finally{clearTimeout(t)}
}
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
function prettySlug(s){if(!s)return "Futbol";return String(s).replace(/[-_.]+/g," ").replace(/\b\w/g,m=>m.toUpperCase())}
function statusType(type,code){if(type==="finished"||Number(code)===100)return "finished";if(type==="notstarted"||type==="scheduled"||Number(code)===0)return "scheduled";return type||"scheduled"}
function sofaEvent(e){
  if(!e?.homeTeam?.id||!e?.awayTeam?.id)return null;
  const hs=n(e?.homeScore?.normaltime??e?.homeScore?.current??e?.homeScore?.display,0),as=n(e?.awayScore?.normaltime??e?.awayScore?.current??e?.awayScore?.display,0);
  const league=e?.tournament?.uniqueTournament?.name||e?.tournament?.name||"Futbol",country=e?.tournament?.category?.name||"Dünya";
  return {
    id:Number(e.id)||e.id,dataSource:"sofascore",startTimestamp:n(e.startTimestamp,0),
    status:{type:statusType(e?.status?.type,e?.status?.code),code:n(e?.status?.code,0)},
    homeTeam:{id:Number(e.homeTeam.id)||e.homeTeam.id,name:e.homeTeam.name||e.homeTeam.shortName||"Ev"},
    awayTeam:{id:Number(e.awayTeam.id)||e.awayTeam.id,name:e.awayTeam.name||e.awayTeam.shortName||"Deplasman"},
    homeScore:{current:hs,normaltime:hs,display:String(hs)},awayScore:{current:as,normaltime:as,display:String(as)},
    tournament:{name:e?.tournament?.name||league,category:{name:country},uniqueTournament:{name:league,id:e?.tournament?.uniqueTournament?.id||null}}
  }
}
function espnEvent(e){
  const c=e?.competitions?.[0]||{},arr=c.competitors||[],h=arr.find(x=>x.homeAway==="home")||arr[0],a=arr.find(x=>x.homeAway==="away")||arr[1];
  if(!h?.team?.id||!a?.team?.id)return null;
  const completed=!!c?.status?.type?.completed,country=c?.venue?.address?.country||"Dünya",leagueName=e?.league?.name||e?.league?.shortName||prettySlug(e?.season?.slug)||"Futbol";
  const hs=n(h?.score?.value??h?.score,0),as=n(a?.score?.value??a?.score,0);
  return {
    id:Number(e.id)||e.id,dataSource:"espn",startTimestamp:Math.floor(new Date(e.date).getTime()/1000),
    status:{type:completed?"finished":"scheduled",code:completed?100:0},
    homeTeam:{id:Number(h.team.id)||h.team.id,name:h.team.displayName||h.team.name||h.team.location||"Ev"},awayTeam:{id:Number(a.team.id)||a.team.id,name:a.team.displayName||a.team.name||a.team.location||"Deplasman"},
    homeScore:{current:hs,normaltime:hs,display:String(hs)},awayScore:{current:as,normaltime:as,display:String(as)},
    tournament:{name:leagueName,category:{name:country},uniqueTournament:{name:leagueName}}
  }
}
const SOFA_HEADERS={"user-agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1","referer":"https://www.sofascore.com/","accept-language":"tr-TR,tr;q=0.9,en;q=0.7"};
async function sofaFixtures(date){
  const urls=[
    "https://www.sofascore.com/api/v1/sport/football/scheduled-events/"+date+"/inverse",
    "https://api.sofascore.com/api/v1/sport/football/scheduled-events/"+date+"/inverse",
    "https://www.sofascore.com/api/v1/sport/football/scheduled-events/"+date
  ];
  let lastErr=null;
  for(const url of urls){try{const d=await getJson(url,6500,SOFA_HEADERS);if(Array.isArray(d?.events))return d.events.map(sofaEvent).filter(Boolean)}catch(e){lastErr=e}}
  throw lastErr||new Error("Sofascore yanıt vermedi")
}
async function espnFixtures(date){
  const compact=String(date).replaceAll("-",""),urls=[
    "https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates="+compact,
    "https://site.web.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates="+compact
  ];
  let lastErr=null;
  for(const url of urls){try{const d=await getJson(url,9000);if(Array.isArray(d?.events))return d.events.map(espnEvent).filter(Boolean)}catch(e){lastErr=e}}
  throw lastErr||new Error("ESPN yanıt vermedi")
}
async function sofaHistory(team,targetTs,limit=10){
  const cutoff=Number(targetTs)||Math.floor(Date.now()/1000);let ev=[],lastErr=null,worked=false;
  for(let page=0;page<5;page++){
    try{
      const d=await getJson("https://www.sofascore.com/api/v1/team/"+team+"/events/last/"+page,6500,SOFA_HEADERS);worked=true;
      const rows=(d.events||[]).map(sofaEvent).filter(Boolean);ev.push(...rows.filter(e=>e.status?.type==="finished"&&e.startTimestamp<cutoff));
      const uniq=[...new Map(ev.map(e=>[e.id,e])).values()];if(uniq.length>=limit||d.hasNextPage===false)break;
    }catch(e){lastErr=e;break}
  }
  if(!worked&&lastErr)throw lastErr;
  return [...new Map(ev.map(e=>[e.id,e])).values()].sort((a,b)=>b.startTimestamp-a.startTimestamp).slice(0,limit)
}
async function espnHistoryFromScoreboards(team,targetTs,limit=10){
  const cutoff=Number(targetTs)||Math.floor(Date.now()/1000);let ev=[];
  // Team schedule endpoints are occasionally blocked for Cloudflare IPs.
  // The global scoreboard endpoint is much more reliable, so scan weekly windows as a fallback.
  for(let w=0;w<14;w++){
    const end=new Date((cutoff-w*7*86400-1)*1000),start=new Date((cutoff-(w+1)*7*86400)*1000);
    const fmt=d=>d.toISOString().slice(0,10).replaceAll("-","");
    try{
      const d=await getJson("https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard?dates="+fmt(start)+"-"+fmt(end)+"&limit=1000",10000,ESPN_HEADERS);
      const rows=(d.events||[]).map(espnEvent).filter(Boolean).filter(e=>e.status?.type==="finished"&&e.startTimestamp<cutoff&&(String(e.homeTeam.id)===String(team)||String(e.awayTeam.id)===String(team)));
      ev.push(...rows);
      ev=[...new Map(ev.map(e=>[e.id,e])).values()];
      if(ev.length>=limit)break
    }catch{}
  }
  return ev.sort((a,b)=>b.startTimestamp-a.startTimestamp).slice(0,limit)
}
async function espnHistory(team,targetTs,limit=10){
  const cutoff=Number(targetTs)||Math.floor(Date.now()/1000),year=new Date(cutoff*1000).getUTCFullYear();let ev=[],worked=false,lastErr=null;
  for(const y of [year,year-1,year-2]){
    let gotYear=false;
    const urls=[
      "https://site.api.espn.com/apis/site/v2/sports/soccer/all/teams/"+team+"/schedule?season="+y,
      "https://site.web.api.espn.com/apis/site/v2/sports/soccer/all/teams/"+team+"/schedule?season="+y
    ];
    for(const url of urls){
      try{
        const d=await getJson(url,9000,ESPN_HEADERS);worked=true;gotYear=true;
        ev=ev.concat((d.events||[]).map(espnEvent).filter(Boolean).filter(e=>e.status?.type==="finished"&&e.startTimestamp<cutoff));
        break
      }catch(e){lastErr=e}
    }
    if([...new Map(ev.map(e=>[e.id,e])).values()].length>=limit)break;
    if(!gotYear&&worked)continue
  }
  ev=[...new Map(ev.map(e=>[e.id,e])).values()];
  if(ev.length<Math.min(5,limit)){
    const fb=await espnHistoryFromScoreboards(team,cutoff,limit);
    ev=[...new Map([...ev,...fb].map(e=>[e.id,e])).values()]
  }
  if(!ev.length&&!worked&&lastErr)throw lastErr;
  return ev.sort((a,b)=>b.startTimestamp-a.startTimestamp).slice(0,limit)
}
async function providerHistory(team,targetTs,limit,source="auto"){
  const src=String(source||"auto").toLowerCase();
  if(src==="sofascore"||src==="sofa")return sofaHistory(team,targetTs,limit);
  if(src==="espn")return espnHistory(team,targetTs,limit);
  try{const e=await espnHistory(team,targetTs,limit);if(e.length)return e}catch{}
  return sofaHistory(team,targetTs,limit)
}
export async function fixtures(date){
  const k="f:"+date,c=cg(k);if(c)return {cached:true,events:c.events,source:c.source,providers:c.providers};
  const errors=[],providers=[];let ev=[];
  try{const s=await sofaFixtures(date);if(s.length){ev=s;providers.push("Sofascore")}}catch(e){errors.push("Sofascore: "+String(e?.message||e))}
  if(!ev.length){try{ev=await espnFixtures(date);providers.push("ESPN")}catch(e){errors.push("ESPN: "+String(e?.message||e))}}
  if(!ev.length&&errors.length)throw new Error(errors.join(" | "));
  const source=providers.join(" + ")||"football data";cs(k,{events:ev,source,providers},300000);return {cached:false,events:ev,source,providers}
}
export async function last(team,source="auto"){
  const k="t:"+source+":"+team,c=cg(k);if(c)return {cached:true,events:c,source};
  const ev=await providerHistory(team,Math.floor(Date.now()/1000),10,source);cs(k,ev,86400000);return {cached:false,events:ev,source}
}
export async function history(team,targetTs,limit=10,source="auto"){
  const day=Math.floor((Number(targetTs)||0)/86400),k="h:"+source+":"+team+":"+day+":"+limit,c=cg(k);if(c)return {cached:true,events:c,source};
  const ev=await providerHistory(team,targetTs,limit,source);cs(k,ev,21600000);return {cached:false,events:ev,source}
}
const sc=(e,s)=>n(e?.[s+"Score"]?.normaltime??e?.[s+"Score"]?.current??e?.[s+"Score"]?.display,0);
function side(e,id){const h=+e.homeTeam.id===+id,gf=h?sc(e,"home"):sc(e,"away"),ga=h?sc(e,"away"):sc(e,"home");return {gf,ga,total:gf+ga,gd:gf-ga,home:h,win:gf>ga,draw:gf===ga,loss:gf<ga,btts:gf>0&&ga>0,scored:gf>0,clean:ga===0,over15:gf+ga>1.5,over25:gf+ga>2.5}}
function stats(ev,id,mode="all"){
  let r=ev.map(e=>side(e,id));if(mode==="home")r=r.filter(x=>x.home);if(mode==="away")r=r.filter(x=>!x.home);if(r.length<3&&mode!=="all")r=ev.map(e=>side(e,id));r=r.slice(0,10);
  let sw=0,gf=0,ga=0,pts=0,o15=0,o25=0,b=0,wins=0,draws=0,scored=0,clean=0,tot=0,tot2=0;
  r.forEach((x,i)=>{const w=.88**i;sw+=w;gf+=x.gf*w;ga+=x.ga*w;pts+=(x.win?3:x.draw?1:0)*w;o15+=(x.over15?1:0)*w;o25+=(x.over25?1:0)*w;b+=(x.btts?1:0)*w;wins+=(x.win?1:0)*w;draws+=(x.draw?1:0)*w;scored+=(x.scored?1:0)*w;clean+=(x.clean?1:0)*w;tot+=x.total*w;tot2+=x.total*x.total*w});
  if(!sw)return {n:0,gf:1.25,ga:1.25,ppg:1.35,over15:.7,over25:.5,btts:.5,win:.33,draw:.28,scored:.7,clean:.25,volatility:.5,momentum:{ppg:1.35,gf:1.25,ga:1.25}};
  const recent=r.slice(0,5);let rw=0,rp=0,rgf=0,rga=0;recent.forEach((x,i)=>{const w=.82**i;rw+=w;rp+=(x.win?3:x.draw?1:0)*w;rgf+=x.gf*w;rga+=x.ga*w});
  const meanTot=tot/sw,variance=Math.max(0,tot2/sw-meanTot*meanTot),volatility=cl(Math.sqrt(variance)/2.2,0,1);
  return {n:r.length,gf:gf/sw,ga:ga/sw,ppg:pts/sw,over15:o15/sw,over25:o25/sw,btts:b/sw,win:wins/sw,draw:draws/sw,scored:scored/sw,clean:clean/sw,volatility,momentum:{ppg:rw?rp/rw:pts/sw,gf:rw?rgf/rw:gf/sw,ga:rw?rga/rw:ga/sw}}
}
const cl=(v,a,b)=>Math.max(a,Math.min(b,v));
const fac=n=>{let r=1;for(let i=2;i<=n;i++)r*=i;return r};
const poi=(k,l)=>Math.exp(-l)*l**k/fac(k);
function dcpm(lh,la,rho=-.08){
  let H=0,D=0,A=0,O=0,U=0,B=0,sum=0;
  for(let h=0;h<=8;h++)for(let a=0;a<=8;a++){
    let tau=1;if(h===0&&a===0)tau=1-lh*la*rho;else if(h===0&&a===1)tau=1+lh*rho;else if(h===1&&a===0)tau=1+la*rho;else if(h===1&&a===1)tau=1-rho;
    const p=Math.max(0,poi(h,lh)*poi(a,la)*tau);sum+=p;if(h>a)H+=p;else if(h===a)D+=p;else A+=p;if(h+a>2.5)O+=p;else U+=p;if(h>0&&a>0)B+=p;
  }
  return {home:H/sum,draw:D/sum,away:A/sum,over25:O/sum,under25:U/sum,btts:B/sum,noBtts:1-B/sum}
}
function exoticMarkets(lh,la){
  const scores=[],totals={b01:0,b23:0,b45:0,b6p:0};let sum=0;
  for(let h=0;h<=9;h++)for(let a=0;a<=9;a++){
    let tau=1;if(h===0&&a===0)tau=1-lh*la*(-.08);else if(h===0&&a===1)tau=1+lh*(-.08);else if(h===1&&a===0)tau=1+la*(-.08);else if(h===1&&a===1)tau=1-(-.08);
    const pr=Math.max(0,poi(h,lh)*poi(a,la)*tau);sum+=pr;scores.push({home:h,away:a,p:pr});
    const t=h+a;if(t<=1)totals.b01+=pr;else if(t<=3)totals.b23+=pr;else if(t<=5)totals.b45+=pr;else totals.b6p+=pr
  }
  scores.forEach(x=>x.p/=sum);Object.keys(totals).forEach(k=>totals[k]/=sum);
  const halfShare=.46,h1=lh*halfShare,a1=la*halfShare,h2=lh*(1-halfShare),a2=la*(1-halfShare),hf={};
  const res=(h,a)=>h>a?"1":h===a?"X":"2";
  for(let h=0;h<=5;h++)for(let a=0;a<=5;a++)for(let sh=0;sh<=6;sh++)for(let sa=0;sa<=6;sa++){
    const pr=poi(h,h1)*poi(a,a1)*poi(sh,h2)*poi(sa,a2),k=res(h,a)+"/"+res(h+sh,a+sa);hf[k]=(hf[k]||0)+pr
  }
  const hsum=Object.values(hf).reduce((s,p)=>s+p,0)||1;Object.keys(hf).forEach(k=>hf[k]/=hsum);
  const fair=p=>p>0?+(1/p).toFixed(2):null,risk=p=>Math.round(cl(100-p*155,48,96));
  const scorelines=scores.sort((x,y)=>y.p-x.p).slice(0,6).map(x=>({key:"CS_"+x.home+"_"+x.away,label:x.home+"-"+x.away,title:"Doğru skor "+x.home+"-"+x.away,probability:pct(x.p),probabilityRaw:+x.p.toFixed(5),fairOdds:fair(x.p),risk:risk(x.p)}));
  const htft=Object.entries(hf).map(([k,p])=>({key:"HTFT_"+k.replace("/","_"),label:k,title:"İY/MS "+k,probability:pct(p),probabilityRaw:+p.toFixed(5),fairOdds:fair(p),risk:risk(p)})).sort((a,b)=>b.probabilityRaw-a.probabilityRaw);
  const goals=[
    ["TG01","0-1 GOL","Toplam gol sayısı 0-1",totals.b01],
    ["TG23","2-3 GOL","Toplam gol sayısı 2-3",totals.b23],
    ["TG45","4-5 GOL","Toplam gol sayısı 4-5",totals.b45],
    ["TG6P","6+ GOL","Toplam gol sayısı 6+",totals.b6p]
  ].map(([key,label,title,p])=>({key,label,title,probability:pct(p),probabilityRaw:+p.toFixed(5),fairOdds:fair(p),risk:risk(p)}));
  return {goals,htft,scorelines}
}
const fairOdds=p=>p>0?+(1/p).toFixed(2):null;
const riskProb=p=>Math.round(cl(96-p*82,18,96));
function poiGE(l,k){let s=0;for(let i=0;i<k;i++)s+=poi(i,Math.max(.05,l));return cl(1-s,0,1)}
function countGE(mean,k,variance=null){
  mean=Math.max(.05,Number(mean)||.05);const v=Number(variance);
  if(!Number.isFinite(v)||v<=mean*1.08)return poiGE(mean,k);
  const r=Math.max(.35,mean*mean/Math.max(.05,v-mean)),p=r/(r+mean);let pm=Math.exp(r*Math.log(p)),sum=pm;
  for(let i=1;i<k;i++){pm*=((i-1+r)/i)*(1-p);sum+=pm}
  return cl(1-sum,0,1)
}
function mkMarket(key,label,title,p,sample=0,extra={}){p=cl(Number(p)||0,.001,.999);return {key,label,title,probability:pct(p),probabilityRaw:+p.toFixed(5),fairOdds:fairOdds(p),risk:riskProb(p),sample,...extra}}
function scoreMatrix(lh,la){
  const rows=[];let sum=0;
  for(let h=0;h<=9;h++)for(let a=0;a<=9;a++){let tau=1;if(h===0&&a===0)tau=1-lh*la*(-.08);else if(h===0&&a===1)tau=1+lh*(-.08);else if(h===1&&a===0)tau=1+la*(-.08);else if(h===1&&a===1)tau=1-(-.08);const pr=Math.max(0,poi(h,lh)*poi(a,la)*tau);rows.push({h,a,p:pr});sum+=pr}
  rows.forEach(x=>x.p/=sum||1);return rows
}
function comboCatalog(lh,la){
  const rows=scoreMatrix(lh,la),sum=f=>rows.reduce((s,x)=>s+(f(x)?x.p:0),0),h=sum(x=>x.h>x.a),d=sum(x=>x.h===x.a),a=sum(x=>x.h<x.a),bt=sum(x=>x.h>0&&x.a>0),o15=sum(x=>x.h+x.a>=2),o25=sum(x=>x.h+x.a>=3),o35=sum(x=>x.h+x.a>=4);
  const result=[
    mkMarket("DC_1X","1X","Çifte şans 1X",h+d,10,{family:"result"}),
    mkMarket("DC_X2","X2","Çifte şans X2",d+a,10,{family:"result"}),
    mkMarket("DC_12","12","Beraberlik olmaz",h+a,10,{family:"result"})
  ];
  const combos=[
    ["C_1_BTTS","1 & KG VAR","Ev sahibi kazanır + KG Var",x=>x.h>x.a&&x.h>0&&x.a>0],
    ["C_2_BTTS","2 & KG VAR","Deplasman kazanır + KG Var",x=>x.h<x.a&&x.h>0&&x.a>0],
    ["C_1_NBTTS","1 & KG YOK","Ev sahibi kazanır + KG Yok",x=>x.h>x.a&&!(x.h>0&&x.a>0)],
    ["C_2_NBTTS","2 & KG YOK","Deplasman kazanır + KG Yok",x=>x.h<x.a&&!(x.h>0&&x.a>0)],
    ["C_1_O15","1 & 1.5 ÜST","Ev sahibi + 1.5 Üst",x=>x.h>x.a&&x.h+x.a>=2],
    ["C_2_O15","2 & 1.5 ÜST","Deplasman + 1.5 Üst",x=>x.h<x.a&&x.h+x.a>=2],
    ["C_1_O25","1 & 2.5 ÜST","Ev sahibi + 2.5 Üst",x=>x.h>x.a&&x.h+x.a>=3],
    ["C_2_O25","2 & 2.5 ÜST","Deplasman + 2.5 Üst",x=>x.h<x.a&&x.h+x.a>=3],
    ["C_1_U35","1 & 3.5 ALT","Ev sahibi + 3.5 Alt",x=>x.h>x.a&&x.h+x.a<=3],
    ["C_2_U35","2 & 3.5 ALT","Deplasman + 3.5 Alt",x=>x.h<x.a&&x.h+x.a<=3],
    ["C_1X_BTTS","1X & KG","1X + Karşılıklı gol",x=>x.h>=x.a&&x.h>0&&x.a>0],
    ["C_X2_BTTS","X2 & KG","X2 + Karşılıklı gol",x=>x.h<=x.a&&x.h>0&&x.a>0],
    ["C_1X_O15","1X & 1.5 ÜST","1X + 1.5 Üst",x=>x.h>=x.a&&x.h+x.a>=2],
    ["C_X2_O15","X2 & 1.5 ÜST","X2 + 1.5 Üst",x=>x.h<=x.a&&x.h+x.a>=2],
    ["C_1X_O25","1X & 2.5 ÜST","1X + 2.5 Üst",x=>x.h>=x.a&&x.h+x.a>=3],
    ["C_X2_O25","X2 & 2.5 ÜST","X2 + 2.5 Üst",x=>x.h<=x.a&&x.h+x.a>=3],
    ["C_BTTS_O25","KG & 2.5 ÜST","KG Var + 2.5 Üst",x=>x.h>0&&x.a>0&&x.h+x.a>=3]
  ].map(([key,label,title,f])=>mkMarket(key,label,title,sum(f),10,{family:"combo"}));
  const goals=[
    mkMarket("O15","1.5 ÜST","Toplam 1.5 Üst",o15,10,{family:"goals"}),
    mkMarket("O35","3.5 ÜST","Toplam 3.5 Üst",o35,10,{family:"goals"}),
    mkMarket("H_TG05","EV 0.5 ÜST","Ev sahibi 1+ gol",sum(x=>x.h>=1),10,{family:"teamGoals",side:"home"}),
    mkMarket("H_TG15","EV 1.5 ÜST","Ev sahibi 2+ gol",sum(x=>x.h>=2),10,{family:"teamGoals",side:"home"}),
    mkMarket("H_TG25","EV 2.5 ÜST","Ev sahibi 3+ gol",sum(x=>x.h>=3),10,{family:"teamGoals",side:"home"}),
    mkMarket("A_TG05","DEP 0.5 ÜST","Deplasman 1+ gol",sum(x=>x.a>=1),10,{family:"teamGoals",side:"away"}),
    mkMarket("A_TG15","DEP 1.5 ÜST","Deplasman 2+ gol",sum(x=>x.a>=2),10,{family:"teamGoals",side:"away"}),
    mkMarket("A_TG25","DEP 2.5 ÜST","Deplasman 3+ gol",sum(x=>x.a>=3),10,{family:"teamGoals",side:"away"})
  ];
  return {result,combos,goals,summary:{home:h,draw:d,away:a,btts:bt,over25:o25}}
}
function firstHalfMarkets(lh,la){
  const h=lh*.46,a=la*.46,rows=[];let sum=0;for(let x=0;x<=6;x++)for(let y=0;y<=6;y++){const p=poi(x,h)*poi(y,a);rows.push({h:x,a:y,p});sum+=p}rows.forEach(x=>x.p/=sum||1);const s=f=>rows.reduce((z,x)=>z+(f(x)?x.p:0),0);
  return [
    mkMarket("FH_1","İY 1","İlk yarı ev sahibi",s(x=>x.h>x.a),10,{family:"firstHalf"}),
    mkMarket("FH_X","İY X","İlk yarı beraberlik",s(x=>x.h===x.a),10,{family:"firstHalf"}),
    mkMarket("FH_2","İY 2","İlk yarı deplasman",s(x=>x.h<x.a),10,{family:"firstHalf"}),
    mkMarket("FH_O05","İY 0.5 ÜST","İlk yarı 0.5 Üst",s(x=>x.h+x.a>=1),10,{family:"firstHalf"}),
    mkMarket("FH_U05","İY 0.5 ALT","İlk yarı 0.5 Alt",s(x=>x.h+x.a===0),10,{family:"firstHalf"}),
    mkMarket("FH_O15","İY 1.5 ÜST","İlk yarı 1.5 Üst",s(x=>x.h+x.a>=2),10,{family:"firstHalf"}),
    mkMarket("FH_BTTS","İY KG VAR","İlk yarı karşılıklı gol",s(x=>x.h>0&&x.a>0),10,{family:"firstHalf"}),
    mkMarket("FH_H05","Ev İY gol","Ev sahibi ilk yarı 1+ gol",s(x=>x.h>=1),10,{family:"firstHalf"}),
    mkMarket("FH_A05","Dep İY gol","Deplasman ilk yarı 1+ gol",s(x=>x.a>=1),10,{family:"firstHalf"})
  ]
}
function countMarkets(context,lh,la){
  const hp=context?.props?.home||{},ap=context?.props?.away||{},sample=Math.min(Number(hp.sample||0),Number(ap.sample||0)),hv=hp.variance||{},av=ap.variance||{},ht=hp.trend||{},at=ap.trend||{},hx=context?.advanced?.home||{},ax=context?.advanced?.away||{};
  const blend=(own,opp,trend,fallback)=>{
    const a=Number(own),b=Number(opp),t=Number(trend),vals=[a,b,t].filter(Number.isFinite);if(!vals.length)return fallback;
    const base=(Number.isFinite(a)?.48*a:0)+(Number.isFinite(b)?.37*b:0)+(Number.isFinite(t)?.15*t:0),w=(Number.isFinite(a)?.48:0)+(Number.isFinite(b)?.37:0)+(Number.isFinite(t)?.15:0);
    return cl((base/w)*cl(.72+sample*.055,.72,.98)+fallback*(1-cl(.72+sample*.055,.72,.98)),.15,45)
  };
  const hAttack=cl(1+(Number(hx.attack||50)-50)*.004+(lh-1.35)*.035,.84,1.18),aAttack=cl(1+(Number(ax.attack||50)-50)*.004+(la-1.15)*.035,.84,1.18),close=1-Math.min(1,Math.abs(lh-la)/Math.max(.7,lh+la)),disciplineFactor=1+close*.035;
  const l={
    hCorners:blend(hp.corners,ap.oppCorners,ht.corners,4.8)*cl(.92+.08*hAttack,.88,1.12),aCorners:blend(ap.corners,hp.oppCorners,at.corners,4.4)*cl(.92+.08*aAttack,.88,1.12),
    hShots:blend(hp.shots,ap.oppShots,ht.shots,11.5)*hAttack,aShots:blend(ap.shots,hp.oppShots,at.shots,10.5)*aAttack,
    hSot:blend(hp.sot,ap.oppSot,ht.sot,3.7)*cl(.94+.10*hAttack,.88,1.14),aSot:blend(ap.sot,hp.oppSot,at.sot,3.4)*cl(.94+.10*aAttack,.88,1.14),
    hCards:blend(hp.yellows,ap.oppYellows,ht.yellows,1.8)*disciplineFactor,aCards:blend(ap.yellows,hp.oppYellows,at.yellows,1.8)*disciplineFactor,
    hFouls:blend(hp.fouls,ap.oppFouls,ht.fouls,11)*disciplineFactor,aFouls:blend(ap.fouls,hp.oppFouls,at.fouls,11)*disciplineFactor,
    hOff:blend(hp.offsides,ap.oppOffsides,ht.offsides,1.5)*cl(.95+.06*hAttack,.9,1.1),aOff:blend(ap.offsides,hp.oppOffsides,at.offsides,1.5)*cl(.95+.06*aAttack,.9,1.1)
  };
  const expectedHSaves=Math.max(.35,l.aSot-la*.78),expectedASaves=Math.max(.35,l.hSot-lh*.78);
  l.hSaves=cl(.58*blend(hp.saves,ap.oppSaves,ht.saves,2.5)+.42*expectedHSaves,.25,9);l.aSaves=cl(.58*blend(ap.saves,hp.oppSaves,at.saves,2.5)+.42*expectedASaves,.25,9);
  const variance=(family,side,total=false)=>{
    const map={corners:"corners",shots:"shots",sot:"sot",cards:"yellows",fouls:"fouls",offsides:"offsides",saves:"saves"},k=map[family];if(!k)return null;
    const one=side==="home"?Number(hv[k]):Number(av[k]),two=side==="home"?Number(av["opp"+k[0].toUpperCase()+k.slice(1)]):Number(hv["opp"+k[0].toUpperCase()+k.slice(1)]);
    if(total){const x=Number(hv[k]),y=Number(av[k]);return Number.isFinite(x)&&Number.isFinite(y)?x+y:null}
    return Number.isFinite(one)?one:Number.isFinite(two)?two:null
  };
  const conf=(lambda,v)=>{const cv=Number.isFinite(v)&&lambda>0?Math.sqrt(Math.max(0,v))/lambda:.75;return Math.round(cl(38+sample*7-cv*10,35,84))};
  const list=(prefix,label,lambda,ks,family,side)=>{const v=variance(family,side,side==="match");return ks.flatMap(k=>{const over=countGE(lambda,k,v),mc=conf(lambda,v);return [
    mkMarket(prefix+k,label+" "+(k-.5)+" ÜST",label+" "+k+"+",over,sample,{family,side,lambda:+lambda.toFixed(2),variance:v==null?null:+v.toFixed(2),marketConfidence:mc,model:"prop_v2",direction:"over",threshold:k}),
    mkMarket(prefix+"U"+k,label+" "+(k-.5)+" ALT",label+" "+(k-.5)+" Alt",1-over,sample,{family,side,lambda:+lambda.toFixed(2),variance:v==null?null:+v.toFixed(2),marketConfidence:mc,model:"prop_v2",direction:"under",threshold:k})
  ]})};
  const corners=[
    ...list("HC_","Ev korner",l.hCorners,[4,5,6],"corners","home"),
    ...list("AC_","Dep korner",l.aCorners,[4,5,6],"corners","away"),
    ...list("TC_","Toplam korner",l.hCorners+l.aCorners,[8,9,10,11],"corners","match")
  ];
  const shots=[
    ...list("HS_","Ev şut",l.hShots,[9,11,13],"shots","home"),
    ...list("AS_","Dep şut",l.aShots,[9,11,13],"shots","away"),
    ...list("HT_","Ev isabetli şut",l.hSot,[3,4,5],"sot","home"),
    ...list("AT_","Dep isabetli şut",l.aSot,[3,4,5],"sot","away"),
    ...list("TT_","Toplam isabetli şut",l.hSot+l.aSot,[7,8,9],"sot","match"),
    ...list("TS_","Toplam şut",l.hShots+l.aShots,[20,22,24],"shots","match")
  ];
  const discipline=[
    ...list("YC_","Toplam sarı kart",l.hCards+l.aCards,[4,5,6],"cards","match"),
    ...list("HYC_","Ev sarı kart",l.hCards,[2,3],"cards","home"),
    ...list("AYC_","Dep sarı kart",l.aCards,[2,3],"cards","away"),
    mkMarket("BOTH_CARD","İKİ TAKIM KART","İki takım da 1+ kart",poiGE(l.hCards,1)*poiGE(l.aCards,1),sample,{family:"cards"}),
    ...list("HF_","Ev faul",l.hFouls,[10,12,14],"fouls","home"),
    ...list("AF_","Dep faul",l.aFouls,[10,12,14],"fouls","away"),
    ...list("TF_","Toplam faul",l.hFouls+l.aFouls,[20,22,24],"fouls","match"),
    ...list("HO_","Ev ofsayt",l.hOff,[1,2,3],"offsides","home"),
    ...list("AO_","Dep ofsayt",l.aOff,[1,2,3],"offsides","away"),
    ...list("TO_","Toplam ofsayt",l.hOff+l.aOff,[3,4,5],"offsides","match")
  ];
  const saves=[
    ...list("HGK_","Ev kaleci kurtarış",l.hSaves,[2,3,4],"saves","home"),
    ...list("AGK_","Dep kaleci kurtarış",l.aSaves,[2,3,4],"saves","away")
  ];
  return {corners,shots,discipline,saves,lambdas:l,sample}
}
function playerMarkets(context){
  const out=[];for(const side of ["home","away"]){const pack=context?.players?.[side];for(const p of pack?.rows||[]){const tag=(side==="home"?"H":"A")+"P_"+p.name.replace(/[^\p{L}\p{N}]+/gu,"_").slice(0,32),sample=Number(p.sample||0),status=pack?.confirmedLineup?"İlk 11 onaylı":"Muhtemel";
    if(Number(p.shots)>=.55){for(const k of [1,2,3])if(k<=Math.max(1,Math.ceil(p.shots+1)))out.push(mkMarket(tag+"_S"+k,p.name+" "+k+"+ şut",p.name+" "+k+"+ şut",poiGE(p.shots,k),sample,{family:"playerShots",side,player:p.name,pos:p.pos,lineupStatus:status,lambda:p.shots}))}
    if(Number(p.sot)>=.25){for(const k of [1,2])if(k<=Math.max(1,Math.ceil(p.sot+1)))out.push(mkMarket(tag+"_T"+k,p.name+" "+k+"+ isabet",p.name+" "+k+"+ isabetli şut",poiGE(p.sot,k),sample,{family:"playerSot",side,player:p.name,pos:p.pos,lineupStatus:status,lambda:p.sot}))}
    if(Number(p.goals)>=.08)out.push(mkMarket(tag+"_GOAL",p.name+" gol atar",p.name+" maçta gol atar",poiGE(p.goals,1),sample,{family:"playerGoals",side,player:p.name,pos:p.pos,lineupStatus:status,lambda:p.goals}));
    if(Number(p.assists)>=.08)out.push(mkMarket(tag+"_AST",p.name+" asist yapar",p.name+" 1+ asist",poiGE(p.assists,1),sample,{family:"playerAssists",side,player:p.name,pos:p.pos,lineupStatus:status,lambda:p.assists}));
    if(Number(p.cards)>=.15)out.push(mkMarket(tag+"_CARD",p.name+" kart görür",p.name+" 1+ kart",poiGE(p.cards,1),sample,{family:"playerCards",side,player:p.name,pos:p.pos,lineupStatus:status,lambda:p.cards}));
    if(Number(p.fouls)>=.35){for(const k of [1,2])out.push(mkMarket(tag+"_F"+k,p.name+" "+k+"+ faul",p.name+" "+k+"+ faul yapar",poiGE(p.fouls,k),sample,{family:"playerFouls",side,player:p.name,pos:p.pos,lineupStatus:status,lambda:p.fouls}))}
    if(Number(p.offsides)>=.18)out.push(mkMarket(tag+"_OFF",p.name+" ofsayta düşer",p.name+" 1+ ofsayt",poiGE(p.offsides,1),sample,{family:"playerOffsides",side,player:p.name,pos:p.pos,lineupStatus:status,lambda:p.offsides}));
    if(Number(p.saves)>=.4||/GK|G$/i.test(p.pos||""))for(const k of [2,3,4])out.push(mkMarket(tag+"_SV"+k,p.name+" "+k+"+ kurtarış",p.name+" "+k+"+ kaleci kurtarışı",poiGE(Math.max(.4,p.saves),k),sample,{family:"playerSaves",side,player:p.name,pos:p.pos,lineupStatus:status,lambda:p.saves}))
  }}
  return out.sort((a,b)=>b.probabilityRaw-a.probabilityRaw).slice(0,60)
}
function marketCatalog(lh,la,context){
  const c=comboCatalog(lh,la),fh=firstHalfMarkets(lh,la),n=countMarkets(context,lh,la),players=playerMarkets(context);
  return {
    categories:[
      {id:"result",label:"Sonuç & Gol",items:[...c.result,...c.goals]},
      {id:"firstHalf",label:"İlk Yarı",items:fh},
      {id:"combo",label:"Kombine Marketler",items:c.combos},
      {id:"corners",label:"Korner",items:n.corners},
      {id:"shots",label:"Şut & İsabet",items:n.shots},
      {id:"discipline",label:"Kart · Faul · Ofsayt",items:n.discipline},
      {id:"saves",label:"Kaleci Kurtarış",items:n.saves},
      {id:"players",label:"Oyuncu",items:players}
    ],
    propsSample:n.sample,lambdas:n.lambdas,playerCount:players.length
  }
}
const pct=v=>Math.round(cl(v,0,1)*100);
function form5(ev,id){return ev.slice(0,5).map(e=>{const s=side(e,id);return {result:s.win?"G":s.draw?"B":"M",score:s.gf+"-"+s.ga}})}
function loadInfo(ev,targetTs){
  const t=Number(targetTs)||Math.floor(Date.now()/1000),past=ev.filter(e=>e.startTimestamp<t).sort((a,b)=>b.startTimestamp-a.startTimestamp),latest=past[0];
  const rest=latest?Math.max(0,(t-latest.startTimestamp)/86400):7,congestion=past.filter(e=>t-e.startTimestamp<=14*86400).length;
  let attackAdj=1,defAdj=1,flags=[];if(rest<3){attackAdj-=.07;defAdj+=.05;flags.push("çok kısa dinlenme")}else if(rest<4){attackAdj-=.035;defAdj+=.025;flags.push("kısa dinlenme")}if(congestion>=4){attackAdj-=.035;defAdj+=.025;flags.push("sıkışık fikstür")}
  return {restDays:+rest.toFixed(1),matches14:congestion,attackAdj,defAdj,flags}
}
export function analyze(home,away,he,ae,targetTs,context={}){
  const cutoff=Number(targetTs)||Infinity;he=(he||[]).filter(e=>e.startTimestamp<cutoff);ae=(ae||[]).filter(e=>e.startTimestamp<cutoff);
  const ha=stats(he,home),aa=stats(ae,away),hh=stats(he,home,"home"),av=stats(ae,away,"away"),hr=loadInfo(he,targetTs),ar=loadInfo(ae,targetTs);
  const q=Math.min(ha.n,aa.n),venueQ=Math.min(hh.n,av.n),teamGoalBase=cl((ha.gf+ha.ga+aa.gf+aa.ga)/4,.8,2.05),env=context?.league?.environment||null,envN=Number(env?.sample||0),envW=envN>=5?cl(envN/70,.18,.82):0;
  const leagueHome=1.42*(1-envW)+Number(env?.avgHome||1.42)*envW,leagueAway=1.16*(1-envW)+Number(env?.avgAway||1.16)*envW;
  const baseH=.70*leagueHome+.30*(teamGoalBase*1.08),baseA=.70*leagueAway+.30*(teamGoalBase*.92);
  const hp=Number(context?.power?.home?.rating||50),ap=Number(context?.power?.away?.rating||50),hs=Number(context?.power?.home?.schedule||50),as=Number(context?.power?.away?.schedule||50),elo=context?.power?.elo||{},eloCoverage=Number(elo.coverage||0),global=context?.power?.global||{},globalCoverage=Number(global.coverage||0);
  const hx=context?.advanced?.home||{},ax=context?.advanced?.away||{},hAdvN=Number(hx.sample||0),aAdvN=Number(ax.sample||0),advN=Math.min(hAdvN,aAdvN);
  const hScheduleFactor=cl(1+(hs-50)*.0022,.94,1.06),aScheduleFactor=cl(1+(as-50)*.0022,.94,1.06);
  const hAtk=(.58*ha.gf+.42*hh.gf)*hScheduleFactor,aAtk=(.58*aa.gf+.42*av.gf)*aScheduleFactor,hDef=(.58*ha.ga+.42*hh.ga)/hScheduleFactor,aDef=(.58*aa.ga+.42*av.ga)/aScheduleFactor;
  let rawH=baseH*Math.sqrt(cl(hAtk/teamGoalBase,.45,2.2)*cl(aDef/teamGoalBase,.45,2.2)),rawA=baseA*Math.sqrt(cl(aAtk/teamGoalBase,.45,2.2)*cl(hDef/teamGoalBase,.45,2.2));
  const shrink=q>=8?.82:q>=5?.70:.56;let lh=baseH*(1-shrink)+rawH*shrink,la=baseA*(1-shrink)+rawA*shrink;
  const longEdge=cl((ha.ppg-aa.ppg)/3,-1,1),recentEdge=cl((ha.momentum.ppg-aa.momentum.ppg)/3,-1,1),ratingEdge=cl((hp-ap)/30,-1,1),eloEdge=cl((Number(elo.home||1500)-Number(elo.away||1500))/220,-1,1),eloW=eloCoverage>=6?.20:eloCoverage>=3?.11:0,globalEdge=cl(Number(global.edge||0),-1,1),globalW=globalCoverage>=10?.14:globalCoverage>=6?.08:0,baseEdge=.43*longEdge+.21*recentEdge+.17*ratingEdge,edge=cl((baseEdge+eloW*eloEdge+globalW*globalEdge)/(.81+eloW+globalW),-1,1);
  lh*=1+.11*edge;la*=1-.095*edge;
  if(advN>=2){
    const hShot=cl(1+(Number(hx.attack||50)-50)*.0022+(50-Number(ax.defense||50))*.0018,.91,1.09);
    const aShot=cl(1+(Number(ax.attack||50)-50)*.0022+(50-Number(hx.defense||50))*.0018,.91,1.09);
    lh*=hShot;la*=aShot
  }
  const hl=context?.lineup?.home||{},al=context?.lineup?.away||{},lineupConfirmed=!!hl.available&&!!al.available;
  if(hl.available||al.available){
    const hLine=cl(1-Number(hl.missingAttackCore||0)*.045+Number(al.missingDefCore||0)*.028,.86,1.12);
    const aLine=cl(1-Number(al.missingAttackCore||0)*.045+Number(hl.missingDefCore||0)*.028,.86,1.12);
    lh*=hLine;la*=aLine
  }
  lh*=hr.attackAdj*ar.defAdj;la*=ar.attackAdj*hr.defAdj;lh=cl(lh,.25,3.7);la=cl(la,.20,3.5);
  const trendO=(ha.over25+aa.over25+hh.over25+av.over25)/4,trendB=(ha.btts+aa.btts+hh.btts+av.btts)/4,leagueO=Number(env?.over25||0)/100,leagueB=Number(env?.btts||0)/100,trendOW=envN>=12?.22:0,trendBW=envN>=12?.18:0,formPush=cl(edge*.05,-.05,.05);
  const scenarioProb=(sh,sa,push=1)=>{
    const x=dcpm(cl(sh,.2,3.8),cl(sa,.18,3.6));
    x.over25=(.68-trendOW)*x.over25+.32*trendO+trendOW*leagueO;x.under25=1-x.over25;x.btts=(.68-trendBW)*x.btts+.32*trendB+trendBW*leagueB;x.noBtts=1-x.btts;
    x.home=cl(x.home+formPush*push,.04,.90);x.away=cl(x.away-formPush*push,.04,.90);const z=x.home+x.draw+x.away;x.home/=z;x.draw/=z;x.away/=z;return x
  };
  const recentHomeShift=cl(((ha.momentum.gf-ha.gf)+(aa.momentum.ga-aa.ga))*.055,-.11,.11),recentAwayShift=cl(((aa.momentum.gf-aa.gf)+(ha.momentum.ga-ha.ga))*.055,-.11,.11);
  const scenarios=[
    {name:"ana",weight:.56,lh,la,p:scenarioProb(lh,la,1)},
    {name:"muhafazakar",weight:.26,lh:cl(lh*.64+baseH*.36,.25,3.7),la:cl(la*.64+baseA*.36,.20,3.5)},
    {name:"form",weight:.18,lh:cl(lh*(1+recentHomeShift),.25,3.7),la:cl(la*(1+recentAwayShift),.20,3.5)}
  ];
  scenarios[1].p=scenarioProb(scenarios[1].lh,scenarios[1].la,.55);scenarios[2].p=scenarioProb(scenarios[2].lh,scenarios[2].la,1.15);
  const probKeys=["home","draw","away","over25","under25","btts","noBtts"],p={};
  for(const k of probKeys)p[k]=scenarios.reduce((sum,x)=>sum+x.weight*Number(x.p[k]||0),0);
  const spreadByKey=Object.fromEntries(probKeys.map(k=>{const a=scenarios.map(x=>Number(x.p[k]||0));return [k,(Math.max(...a)-Math.min(...a))*100]})),scenarioSpread=Math.max(...Object.values(spreadByKey)),stability=Math.round(cl(100-scenarioSpread*2.15,45,100));
  const keyMap={"1":"home","X":"draw","2":"away","O25":"over25","U25":"under25","BTTS":"btts","NBTTS":"noBtts"};
  const ms=[["1","1","Ev sahibi kazanır",p.home],["X","X","Beraberlik",p.draw],["2","2","Deplasman kazanır",p.away],["O25","2.5 ÜST","Toplam 2.5 Üst",p.over25],["U25","2.5 ALT","Toplam 2.5 Alt",p.under25],["BTTS","KG VAR","Karşılıklı gol var",p.btts],["NBTTS","KG YOK","Karşılıklı gol yok",p.noBtts]].map(([key,label,title,z])=>({key,label,title,probability:pct(z),probabilityRaw:+cl(z,0,1).toFixed(5),stability:Math.round(cl(100-spreadByKey[keyMap[key]]*2.4,40,100))}));
  const sampleQ=.52*cl(q/10,0,1)+.15*cl(venueQ/5,0,1)+.08*(1-(ha.volatility+aa.volatility)/2),leagueQ=.05*(env?cl(envN/35,.25,1):.25),schedSamples=Number(context?.power?.home?.scheduleSample||0)+Number(context?.power?.away?.scheduleSample||0),scheduleQ=.04*cl(schedSamples/6,0,1),advancedQ=.06*cl(advN/4,0,1),eloQ=.07*cl(eloCoverage/10,0,1),globalQ=.01*cl(globalCoverage/12,0,1),lineupQ=.02*(lineupConfirmed?1:((hl.available||al.available)?0.5:0)),quality=Math.round(100*cl(sampleQ+leagueQ+scheduleQ+advancedQ+eloQ+globalQ+lineupQ,0,1));
  const best=[...ms].sort((a,b)=>b.probability-a.probability)[0],binaryStrength=Math.abs(best.probability-50),volPenalty=8*((ha.volatility+aa.volatility)/2),dataPenalty=quality<55?8:quality<70?4:0,stabilityPenalty=(100-stability)*.22;
  const confidence=Math.round(cl(47+binaryStrength*1.32+Math.min(9,Math.abs(edge)*11)-volPenalty-dataPenalty-stabilityPenalty,38,88)),signal=confidence>=74&&best.probability>=60&&stability>=76?"Güçlü":confidence>=62&&best.probability>=55&&stability>=64?"Orta":"Zayıf";
  const flags=[...hr.flags.map(x=>"Ev: "+x),...ar.flags.map(x=>"Dep: "+x)];if(q<6)flags.push("maç örneği az");if((ha.volatility+aa.volatility)/2>.7)flags.push("gol dağılımı oynak");if(stability<64)flags.push("senaryolar arası tahmin farkı yüksek");else if(stability<76)flags.push("senaryo stabilitesi orta");if(envN>0&&envN<10)flags.push("lig/kupa örneği az");if(schedSamples<3)flags.push("rakip gücü örneği sınırlı");if(advN<2)flags.push("şut kalitesi verisi sınırlı");if(eloCoverage<3)flags.push("kronolojik Elo örneği sınırlı");if(globalCoverage<6)flags.push("çapraz-lig güç ağı sınırlı");if(hl.available&&Number(hl.missingAttackCore||0)>0)flags.push("ev hücum çekirdeğinde eksik");if(al.available&&Number(al.missingAttackCore||0)>0)flags.push("dep hücum çekirdeğinde eksik");
  const reasons=["Ensemble beklenen gol: "+lh.toFixed(2)+" - "+la.toFixed(2)+" · stabilite "+stability+"/100","Güç ratingi: "+hp.toFixed(1)+" - "+ap.toFixed(1),"Rakip zorluğu: "+hs.toFixed(1)+" - "+as.toFixed(1),"Son 5 form puanı: "+ha.momentum.ppg.toFixed(2)+" - "+aa.momentum.ppg.toFixed(2)];if(eloCoverage>=3)reasons.push("Kronolojik lig Elo: "+Number(elo.home||1500).toFixed(0)+" - "+Number(elo.away||1500).toFixed(0)+" ("+eloCoverage+"+ maç)");if(globalCoverage>=6)reasons.push("Çapraz-lig güç endeksi: "+Number(global.home?.rating||1500).toFixed(0)+" - "+Number(global.away?.rating||1500).toFixed(0));
  if(advN>=2)reasons.push("Atak Kalitesi: "+Number(hx.attack||50).toFixed(1)+" - "+Number(ax.attack||50).toFixed(1)+" ("+advN+" maç)");
  if(envN>=5)reasons.push((context?.league?.name||"Lig")+" gol ortalaması: "+Number(env.avgTotal||0).toFixed(2)+" ("+envN+" maç)");
  if(hl.available||al.available)reasons.push("İlk 11 etkisi: ev hücum eksik "+Number(hl.missingAttackCore||0)+" · dep hücum eksik "+Number(al.missingAttackCore||0));
  reasons.push("Dinlenme ve fikstür yoğunluğu hesaba katıldı");
  const exotic=exoticMarkets(lh,la),catalog=marketCatalog(lh,la,context),scenarioRange={home:[Math.min(...scenarios.map(x=>x.lh)),Math.max(...scenarios.map(x=>x.lh))],away:[Math.min(...scenarios.map(x=>x.la)),Math.max(...scenarios.map(x=>x.la))]};
  const standardCatalog=ms.map(x=>({...x,fairOdds:fairOdds(x.probabilityRaw),risk:Math.round(cl(riskProb(x.probabilityRaw)+(100-Number(x.stability||stability))*.16,18,98)),sample:q,family:"standard"}));
  if(catalog.categories?.[0])catalog.categories[0].items=[...standardCatalog,...catalog.categories[0].items];
  return {modelVersion:"5.2",sample:{home:ha.n,away:aa.n},dataQuality:quality,signal,stability,scenarioSpread:+scenarioSpread.toFixed(1),modelDiagnostics:{ensemble:true,stability,scenarioSpread:+scenarioSpread.toFixed(1),scenarios:scenarios.map(x=>({name:x.name,weight:x.weight,xgHome:+x.lh.toFixed(2),xgAway:+x.la.toFixed(2)}))},riskFlags:flags,rest:{home:hr,away:ar},context:{league:context?.league||null,power:context?.power||null,advanced:context?.advanced||null,props:context?.props||null,players:context?.players||null,lineup:context?.lineup||null},form:{home:form5(he,home),away:form5(ae,away)},expectedGoals:{home:+lh.toFixed(2),away:+la.toFixed(2),total:+(lh+la).toFixed(2),scenarioRange:{home:scenarioRange.home.map(x=>+x.toFixed(2)),away:scenarioRange.away.map(x=>+x.toFixed(2))}},stats:{home:{gf:+ha.gf.toFixed(2),ga:+ha.ga.toFixed(2),ppg:+ha.ppg.toFixed(2),ppg5:+ha.momentum.ppg.toFixed(2),over25:pct(ha.over25),btts:pct(ha.btts),clean:pct(ha.clean),scored:pct(ha.scored)},away:{gf:+aa.gf.toFixed(2),ga:+aa.ga.toFixed(2),ppg:+aa.ppg.toFixed(2),ppg5:+aa.momentum.ppg.toFixed(2),over25:pct(aa.over25),btts:pct(aa.btts),clean:pct(aa.clean),scored:pct(aa.scored)}},markets:ms,exotic,catalog,bestPick:best,confidence,reasons}
}