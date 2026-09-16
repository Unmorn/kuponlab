import { history, analyze as build } from "../lib/core.js";
import { buildMatchContext, compareMarket } from "../lib/context.js";
import { loadCalibration, applyCalibration } from "../lib/backtest.js";
import { decorateAnalysis } from "../lib/product.js";
import { enrichWithIddaa } from "../lib/iddaa.js";
import { marketPerformanceSummary, applyPerformanceToAnalysis, recordAnalysisPredictions } from "../lib/performance.js";
import { attachLineupImpact } from "../lib/lineup.js";
export const access="public";
export const methods=["GET"];

async function optional(label,fn,fallback,warnings){
  try{return await fn()}catch(e){warnings.push(label+": "+String(e?.message||e));return fallback}
}

export default async function(req,res){
  const home=Number(req.query.home),away=Number(req.query.away),ts=Number(req.query.ts)||Math.floor(Date.now()/1000),eventId=req.query.event?String(req.query.event):null,source=String(req.query.source||"auto").toLowerCase(),homeName=String(req.query.homeName||"").slice(0,120),awayName=String(req.query.awayName||"").slice(0,120),iddaaEventId=req.query.iddaaEvent?String(req.query.iddaaEvent):null;
  if(!home||!away)return res.status(400).json({ok:false,error:"Takım kimlikleri eksik."});
  const warnings=[];
  try{
    const [h,a,cal,performance]=await Promise.all([
      optional("home_history",()=>history(home,ts,10,source),{events:[]},warnings),
      optional("away_history",()=>history(away,ts,10,source),{events:[]},warnings),
      optional("calibration",()=>loadCalibration(),{rows:[],total:0},warnings),
      optional("performance",()=>marketPerformanceSummary(),null,warnings)
    ]);
    const homeEvents=h.events||[],awayEvents=a.events||[],context=await optional("match_context",()=>buildMatchContext(eventId,home,away,ts,homeEvents,awayEvents,source,{homeName,awayName}),{teams:{home:homeName,away:awayName},diagnostics:{currentSummaryAvailable:false,identityFallback:true}},warnings);
    const raw=build(home,away,homeEvents,awayEvents,ts,context||{}),insufficientData=Math.min(homeEvents.length,awayEvents.length)<3;
    if(insufficientData){raw.signal="Yetersiz veri";raw.confidence=Math.min(Number(raw.confidence||38),38);raw.riskFlags=[...new Set([...(raw.riskFlags||[]),"en az bir takım için geçmiş maç verisi yetersiz"])];warnings.push("history_sample: güvenilir analiz için iki takımda da en az 3 maç gerekir")}
    const calibrated=applyCalibration(raw,cal?.rows||[]),resolvedHome=context?.teams?.home||homeName,resolvedAway=context?.teams?.away||awayName;
    let enriched=await optional("iddaa",()=>enrichWithIddaa({...calibrated,backtestMatches:Number(cal?.total||0)},resolvedHome,resolvedAway,ts,{eventId:iddaaEventId}),{...calibrated,backtestMatches:Number(cal?.total||0),iddaa:{matched:false,reason:"unavailable"}},warnings);
    if(performance)enriched=applyPerformanceToAnalysis(enriched,performance);
    if(eventId)enriched=await optional("lineup",()=>attachLineupImpact(eventId,ts,enriched),enriched,warnings);
    if(eventId)try{await recordAnalysisPredictions({id:eventId,startTimestamp:ts},enriched,"single")}catch{}
    const marketComparison=compareMarket(enriched,context?.market),analysis={...enriched,insufficientData,marketComparison,product:decorateAnalysis(enriched,marketComparison),dataWarnings:warnings,dataStatus:insufficientData?"insufficient":warnings.length?"degraded":"full",historySamples:{home:homeEvents.length,away:awayEvents.length}};
    return res.json({ok:true,analysis,warnings})
  }catch(e){
    return res.status(502).json({ok:false,error:"Analiz için gerekli veriler alınamadı.",stage:"model_core",detail:String(e?.message||e),warnings})
  }
}
