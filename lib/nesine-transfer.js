import { iddaaEventDetail, enrichMarkets } from "./iddaa.js";

const N="https://www.nesine.com",ISC="https://isc.nesine.com/savedcoupon";
let authCache={v:null,e:0};
async function publicAuth(){
  if(authCache.v&&authCache.e>Date.now())return authCache.v;
  try{
    const r=await fetch(N+"/iddaa",{headers:{"user-agent":"Mozilla/5.0","accept":"text/html,*/*"}});
    const h=await r.text(),m=h.match(/var\s+SGAuthKey\s*=\s*'([^']+)'/);
    const v=m?.[1]||null;if(v)authCache={v,e:Date.now()+15*60*1000};return v
  }catch{return null}
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let n=0;
  async function w(){while(true){const i=n++;if(i>=items.length)return;try{out[i]=await fn(items[i],i)}catch(e){out[i]={ok:false,error:String(e?.message||e)}}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>w()));return out
}
function norm(s){return String(s||"").toLocaleLowerCase("tr").replaceAll("ı","i").replaceAll("İ","i").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim()}
function pickRow(rows,p){
  const mid=String(p.iddaaMarketId||""),ono=Number(p.iddaaOutcomeNo),on=norm(p.iddaaOutcomeName||p.pick||"");
  let r=null;
  if(mid&&Number.isFinite(ono)&&ono>0)r=rows.find(x=>String(x.marketId)===mid&&Number(x.outcomeNo)===ono);
  if(!r&&mid&&on)r=rows.find(x=>String(x.marketId)===mid&&norm(x.outcomeName)===on);
  if(!r&&mid&&on)r=rows.find(x=>String(x.marketId)===mid&&(norm(x.outcomeName).includes(on)||on.includes(norm(x.outcomeName))));
  return r||null
}
async function validateOne(p){
  const eventId=String(p.iddaaEventId||"");
  if(!eventId)return {ok:false,match:p.match||"",pick:p.pick||"",reason:"İddaa event kimliği yok."};
  const d=await iddaaEventDetail(eventId);
  if(!d)return {ok:false,match:p.match||"",pick:p.pick||"",reason:"Maç artık İddaa bülteninde bulunamadı."};
  const rows=await enrichMarkets(d),r=pickRow(rows,p);
  if(!r||!(Number(r.odd)>1))return {ok:false,match:p.match||"",pick:p.pick||"",eventId,reason:"Market veya seçim artık açık değil."};
  return {
    ok:true,match:p.match||"",pick:p.pick||r.outcomeName,eventId:Number(eventId),marketId:Number(r.marketId),
    outcomeNo:Number(r.outcomeNo),outcomeName:r.outcomeName,marketName:r.marketName,currentOdd:+Number(r.odd).toFixed(2),
    previousOdd:Number(p.decimal)>1?+Number(p.decimal).toFixed(2):null,mbs:Number(r.mbs||p.mbs||0)||null,
    marketVersion:Number(r.marketVersion||0),eventVersion:Number(r.eventVersion||d?.v||0),eventStart:Number(d?.d||p.startTimestamp||0),
    banko:!!p.banko
  }
}
function base64url(text){
  const bytes=new TextEncoder().encode(String(text||""));let bin="";
  for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")
}
function externalCoupon(valid){
  return {
    co:valid.map(x=>({c:x.eventId,m:x.marketId,o:x.outcomeNo,odd:x.currentOdd,bs:x.banko?1:0})),
    s:"",m:1,mc:1
  }
}
function shareCoupon(valid){
  const co=valid.map(x=>({
    c:x.eventId,o:x.outcomeNo,m:x.marketId,mv:x.marketVersion||0,ev:x.eventVersion||0,bs:x.banko?1:0,
    ad:Date.now(),odd:x.currentOdd,oodd:null,mbc:x.mbs||1,esd:x.eventStart?x.eventStart*1000:0,
    ism:false,d:x.eventStart?x.eventStart*1000:0,os:1,pnt:true,en:x.match,mno:"",t:1,on:x.outcomeName,
    i:null,nid:x.eventId,ivb:false
  }));
  const total=co.reduce((n,x)=>n*Number(x.odd||1),1);
  return {co,s:"",m:1,mc:1,kri:null,tnodd:+total.toFixed(2),todd:+total.toFixed(2),tng:0,tg:0,pid:1,sc:null,ilw:0,info:{}}
}
async function tryOfficialShare(valid){
  const auth=await publicAuth();if(!auth)return {ok:false,reason:"nesine_auth_config_unavailable"};
  try{
    const r=await fetch(ISC+"/shareassocialfeed",{
      method:"POST",
      headers:{"content-type":"application/json","accept":"application/json","authorization":auth,"origin":N,"referer":N+"/iddaa","user-agent":"Mozilla/5.0"},
      body:JSON.stringify({Coupon:shareCoupon(valid),MediaType:"paylaşılan kupon"})
    }),j=await r.json().catch(()=>null),url=j?.d?.shareUrl?.d||null;
    if(Number(j?.sc)===200&&url)return {ok:true,url};
    if(Number(j?.sc)===401)return {ok:false,reason:"nesine_member_session_required"};
    return {ok:false,reason:"nesine_share_rejected",code:j?.sc??r.status}
  }catch(e){return {ok:false,reason:"nesine_share_unavailable",error:String(e?.message||e)}}
}
export async function prepareNesineTransfer(picks=[]){
  const input=(Array.isArray(picks)?picks:[]).slice(0,60),official=input.filter(x=>x?.oddsType==="iddaa"||x?.iddaaStatus==="open"),nonOfficial=input.filter(x=>!(x?.oddsType==="iddaa"||x?.iddaaStatus==="open"));
  if(!official.length)return {ready:false,reason:"no_official_picks",total:input.length,valid:[],invalid:input.map(x=>({match:x.match||"",pick:x.pick||"",reason:"Gerçek İddaa marketi değil."}))};
  const checked=await mapLimit(official,5,validateOne),valid=checked.filter(x=>x?.ok),invalid=[...nonOfficial.map(x=>({ok:false,match:x.match||"",pick:x.pick||"",reason:"Model/piyasa seçimi; Nesine transferi için gerçek İddaa marketi gerekiyor."})),...checked.filter(x=>!x?.ok)];
  const byEvent=new Map();for(const x of valid){const k=String(x.eventId),a=byEvent.get(k)||[];a.push(x);byEvent.set(k,a)}
  const warnings=[];for(const a of byEvent.values())if(a.length>1)warnings.push(a[0].match+": aynı maçtan "+a.length+" ayrı market var; Nesine bunları ayrı seçim olarak kabul etmeyebilir.");
  const maxMbs=valid.reduce((m,x)=>Math.max(m,Number(x.mbs||0)),0),mbsSatisfied=maxMbs<=valid.length;
  if(!mbsSatisfied)warnings.push("MBS "+maxMbs+" için en az "+maxMbs+" seçim gerekir.");
  const allValid=valid.length===input.length&&invalid.length===0;
  const share=allValid&&valid.length?await tryOfficialShare(valid):{ok:false,reason:"coupon_has_invalid_picks"};
  return {
    ready:!!share.ok,shareUrl:share.url||null,reason:share.ok?"ready":share.reason,
    total:input.length,official:official.length,validCount:valid.length,invalidCount:invalid.length,
    maxMbs,mbsSatisfied,warnings,valid,invalid,externalCoupon:externalCoupon(valid),
    bridgePayload:valid.length?base64url(JSON.stringify({v:1,ts:Date.now(),co:externalCoupon(valid).co,s:"",m:1,mc:1})):null,
    openUrl:N+"/iddaa",
    note:share.ok?"Nesine kupon linki hazır. Son oynama onayı Nesine içinde yapılır.":"Nesine doğrudan dış-site aktarımını engellediği için KuponLab Bridge ile tarayıcı içinde güvenli otomatik doldurma kullanılır."
  }
}