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
  const home=Number(req.query.home),away=Number(req.query.away),ts=Number(req.query.ts)||Math.floor(Date.now()/1000),eventId=req.query.event?String(req.query.event):null,source=String(req.query.source||"auto").toLowerCase();
  if(!home||!away)return res.status(400).json({ok:false,error:"Takım kimlikleri eksik."});
  const warnings=[];
  try{
    const [h,a,cal,performance]=await Promise.all([
      optional("home_history",()=>history(home,ts,10,source),{events:[]},warnings),
      optional("away_history",()=>history(away,ts,10,source),{events:[]},warnings),
      optional("calibration",()=>loadCalibration(),{rows:[],total:0},warnings),
      optional("performance",()=>marketPerformanceSummary(),null,warnings)
    ]);
    const context=await optional("match_context",()=>buildMatchContext(eventId,home,away,ts,h.events||[],a.events||[],source),{},warnings);
    const raw=build(home,away,h.events||[],a.events||[],ts,context||{}),calibrated=applyCalibration(raw,cal?.rows||[]);
    let enriched=await optional("iddaa",()=>enrichWithIddaa({...calibrated,backtestMatches:Number(cal?.total||0)},context?.teams?.home||"",context?.teams?.away||"",ts),{...calibrated,backtestMatches:Number(cal?.total||0),iddaa:{matched:false,reason:"unavailable"}},warnings);
    if(performance)enriched=applyPerformanceToAnalysis(enriched,performance);
    if(eventId)enriched=await optional("lineup",()=>attachLineupImpact(eventId,ts,enriched),enriched,warnings);
    if(eventId)try{await recordAnalysisPredictions({id:eventId,startTimestamp:ts},enriched,"single")}catch{}
    const marketComparison=compareMarket(enriched,context?.market),analysis={...enriched,marketComparison,product:decorateAnalysis(enriched,marketComparison),dataWarnings:warnings,dataStatus:warnings.length?"degraded":"full",historySamples:{home:(h.events||[]).length,away:(a.events||[]).length}};
    return res.json({ok:true,analysis,warnings})
  }catch(e){
    return res.status(502).json({ok:false,error:"Analiz için gerekli veriler alınamadı.",stage:"model_core",detail:String(e?.message||e),warnings})
  }
}