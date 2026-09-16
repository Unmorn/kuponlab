import { backfillPerformanceDate, gradePendingPredictions, marketPerformanceSummary } from "../lib/performance.js";
import { dateDaysAgo } from "../lib/backtest.js";
export const access="scheduler";
export const schedule="35 3 * * *";
export default async function(req,res){
  try{
    const day=new Date().getUTCDate(),offset=10+((day*7)%49);
    const yesterday=await backfillPerformanceDate(dateDaysAgo(1),{limit:3});
    const older=await backfillPerformanceDate(dateDaysAgo(offset),{limit:1});
    const graded=await gradePendingPredictions(6),summary=await marketPerformanceSummary();
    return res.json({ok:true,offset,yesterday,older,graded,summary})
  }catch(e){return res.status(500).json({ok:false,error:String(e?.message||e)})}
}