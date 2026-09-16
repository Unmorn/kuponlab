import { history, analyze as build } from "../lib/core.js";
import { buildMatchContext, compareMarket } from "../lib/context.js";
import { loadCalibration, applyCalibration } from "../lib/backtest.js";
import { decorateAnalysis } from "../lib/product.js";
import { enrichWithIddaa } from "../lib/iddaa.js";
import { marketPerformanceSummary, applyPerformanceToAnalysis, recordAnalysisPredictions } from "../lib/performance.js";
import { attachLineupImpact } from "../lib/lineup.js";
export const access="public";
export const methods=["GET"];
export default async function(req,res){
  const home=Number(req.query.home),away=Number(req.query.away),ts=Number(req.query.ts)||Math.floor(Date.now()/1000),eventId=req.query.event?String(req.query.event):null;
  if(!home||!away)return res.status(400).json({ok:false,error:"Takım kimlikleri eksik."});
  try{
    const [h,a,cal,performance]=await Promise.all([history(home,ts,10),history(away,ts,10),loadCalibration(),marketPerformanceSummary()]);
    const context=await buildMatchContext(eventId,home,away,ts,h.events,a.events);
    const raw=build(home,away,h.events,a.events,ts,context),calibrated=applyCalibration(raw,cal.rows);
    let enriched=await enrichWithIddaa({...calibrated,backtestMatches:cal.total},context?.teams?.home||"",context?.teams?.away||"",ts);
    enriched=applyPerformanceToAnalysis(enriched,performance);if(eventId)enriched=await attachLineupImpact(eventId,ts,enriched);
    if(eventId)try{await recordAnalysisPredictions({id:eventId,startTimestamp:ts},enriched,"single")}catch{}
    const marketComparison=compareMarket(enriched,context.market),analysis={...enriched,marketComparison,product:decorateAnalysis(enriched,marketComparison)};
    return res.json({ok:true,analysis})
  }catch(e){
    return res.status(502).json({ok:false,error:"Analiz için gerekli veriler alınamadı.",detail:String(e?.message||e)})
  }
}