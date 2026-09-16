import { backfillPerformanceDate, gradePendingPredictions, marketPerformanceSummary } from "../lib/performance.js";
export const access="admin";
export const methods=["POST"];
export default async function(req,res){
  const date=String(req.query.date||""),limit=Math.max(1,Math.min(12,Number(req.query.limit||8)));
  try{
    const backfill=/^\d{4}-\d{2}-\d{2}$/.test(date)?await backfillPerformanceDate(date,{limit}):null;
    const graded=await gradePendingPredictions(40),summary=await marketPerformanceSummary();
    return res.json({ok:true,backfill,graded,summary})
  }catch(e){return res.status(502).json({ok:false,error:"Performans backfill başarısız.",detail:String(e?.message||e)})}
}
