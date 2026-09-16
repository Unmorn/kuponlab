import { backfillPerformanceRange, gradePendingPredictions, marketPerformanceSummary } from "../lib/performance.js";
export const access="admin";
export const methods=["POST"];
export default async function(req,res){
  const from=String(req.query.from||""),days=Math.max(1,Math.min(8,Number(req.query.days||4))),perDay=Math.max(1,Math.min(6,Number(req.query.perDay||3)));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from))return res.status(400).json({ok:false,error:"Tarih geçersiz."});
  try{const run=await backfillPerformanceRange(from,{days,perDay}),graded=await gradePendingPredictions(80),summary=await marketPerformanceSummary();return res.json({ok:true,run,graded,summary})}
  catch(e){return res.status(500).json({ok:false,error:String(e?.message||e)})}
}
