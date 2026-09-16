// ==UserScript==
// @name         KuponLab → Nesine Bridge
// @namespace    https://kuponlab.app/
// @version      1.0.0
// @description  KuponLab'da doğrulanan İddaa seçimlerini Nesine kuponuna otomatik ekler. Bahsi otomatik oynatmaz.
// @match        https://www.nesine.com/iddaa*
// @match        https://www.nesine.com/bet/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function(){
  "use strict";
  if(window.__KUPONLAB_NESINE_BRIDGE__) return;
  window.__KUPONLAB_NESINE_BRIDGE__=true;

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const toast=(title,text,bad=false)=>{
    let el=document.getElementById("kuponlab-bridge-toast");
    if(!el){
      el=document.createElement("div");el.id="kuponlab-bridge-toast";
      el.style.cssText="position:fixed;left:12px;right:12px;top:12px;z-index:2147483647;padding:12px 14px;border-radius:12px;background:#11191d;color:#eef4f5;border:1px solid #355b61;box-shadow:0 12px 34px rgba(0,0,0,.35);font:600 13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif";
      document.documentElement.appendChild(el);
    }
    el.style.borderColor=bad?"#7a4040":"#355b61";
    el.innerHTML="<b style='display:block;margin-bottom:3px'>"+title+"</b><span style='color:#9fb0b4'>"+text+"</span>";
    clearTimeout(window.__klToastTimer);window.__klToastTimer=setTimeout(()=>el.remove(),6500);
  };
  const decode=s=>{
    s=String(s||"").replace(/-/g,"+").replace(/_/g,"/");
    while(s.length%4)s+="=";
    const bin=atob(s),bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  const raw=(location.hash.match(/(?:^#|&)kuponlab=([^&]+)/)||[])[1];
  if(!raw)return;

  let payload;
  try{payload=decode(raw)}catch(e){toast("KuponLab Bridge","Aktarım paketi okunamadı.",true);return}
  try{history.replaceState(null,"",location.pathname+location.search)}catch{}
  if(payload?.v!==1||!Array.isArray(payload?.co)||!payload.co.length){toast("KuponLab Bridge","Aktarım paketi boş veya uyumsuz.",true);return}
  if(payload.ts&&Date.now()-Number(payload.ts)>20*60*1000){toast("KuponLab Bridge","Bu aktarım paketi 20 dakikadan eski. KuponLab'dan tekrar gönder.",true);return}

  async function waitReady(){
    for(let i=0;i<120;i++){
      if(window.CouponManager?.AddEventToCoupon&&window.ProgramManager)return true;
      await sleep(250);
    }
    return false
  }
  async function waitEvent(id){
    for(let i=0;i<60;i++){
      try{
        const a=window.ProgramManager?.GetProgramEventsByNIDOrEventId?.(id);
        const b=window.ProgramManager?.GetProgramEventByNIdOrEventId?.(id);
        if((Array.isArray(a)&&a.length)||b)return true;
      }catch{}
      await sleep(200);
    }
    return false
  }
  const norm=s=>String(s||"").toLocaleLowerCase("tr").replaceAll("ı","i").replaceAll("İ","i").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9çğıöşü]+/g," ").replace(/\s+/g," ").trim();
  function resolveOutcome(p){
    try{
      const market=window.ProgramManager?.GetMarket?.(Number(p.c),Number(p.m));
      if(!market)return {id:Number(p.o)||null,odd:Number(p.odd)||null};
      const oc=market.OC||{};
      if(Number(p.o)&&oc[p.o])return {id:Number(p.o),odd:Number(oc[p.o]?.O||p.odd)||Number(p.odd)||null};
      const want=norm(p.on||p.outcomeName||"");
      for(const k of Object.keys(oc)){
        let name="";
        try{name=window.ProgramManager?.GetCouponOutcomeName?.(Number(p.c),Number(p.m),Number(k))||oc[k]?.N||oc[k]?.ON||""}catch{}
        if(want&&norm(name)===want)return {id:Number(k),odd:Number(oc[k]?.O||p.odd)||Number(p.odd)||null};
      }
      for(const k of Object.keys(oc)){
        let name="";
        try{name=window.ProgramManager?.GetCouponOutcomeName?.(Number(p.c),Number(p.m),Number(k))||oc[k]?.N||oc[k]?.ON||""}catch{}
        const n=norm(name);if(want&&n&&(n.includes(want)||want.includes(n)))return {id:Number(k),odd:Number(oc[k]?.O||p.odd)||Number(p.odd)||null};
      }
      return {id:null,odd:null}
    }catch{return {id:Number(p.o)||null,odd:Number(p.odd)||null}}
  }
  async function addOne(p){
    await waitEvent(Number(p.c));
    try{
      const r=resolveOutcome(p);if(!r.id)return false;
      if(window.CouponManager?.AddEventToCoupon){
        window.CouponManager.AddEventToCoupon(Number(p.c),Number(p.m),Number(r.id),Number(r.odd||p.odd),null);
      }else if(window.IddaaCoupon?.PostJParams){
        window.IddaaCoupon.PostJParams({action:"addevent",C:Number(p.c),M:Number(p.m),O:Number(r.id)},null);
      }else return false;
      await sleep(260);
      return true;
    }catch(e){return false}
  }
  async function openCoupon(){
    try{
      if(window.ResponsiveCoupon?.ToggleCoupon)window.ResponsiveCoupon.ToggleCoupon(true);
      await sleep(200);
      const mobile=document.querySelector("#tabbar .coupon, #coupon-info, .coupon");
      if(mobile&&typeof mobile.click==="function"&&window.innerWidth<800)mobile.click();
    }catch{}
  }
  (async()=>{
    if(!await waitReady()){toast("KuponLab Bridge","Nesine kupon sistemi yüklenemedi. Sayfayı yenileyip KuponLab'dan tekrar gönder.",true);return}
    toast("KuponLab Bridge","Seçimler Nesine kuponuna ekleniyor…");
    let ok=0;
    for(const p of payload.co)if(await addOne(p))ok++;
    await openCoupon();
    if(ok===payload.co.length)toast("KuponLab → Nesine",""+ok+" seçim kupona gönderildi. Oranları kontrol edip son onayı Nesine'de sen ver.");
    else toast("KuponLab → Nesine",ok+"/"+payload.co.length+" seçim gönderildi. Bazı marketler Nesine'de kapanmış/değişmiş olabilir.",true);
  })();
})();