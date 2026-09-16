import { runBacktestDate, recomputeCalibration, dateDaysAgo } from "../lib/backtest.js";
export const access="admin";
export const methods=["GET","POST"];
export default async function(req,res){
  try{
    const days=Math.max(1,Math.min(5,Number(req.query.days)||1)),limit=Math.max(5,Math.min(30,Number(req.query.limit)||16)),offset=Math.max(1,Math.min(90,Number(req.query.offset)||1)),date=req.query.date;
    const runs=[];
    if(date)runs.push(await runBacktestDate(String(date),{limit}));
    else for(let i=offset;i<offset+days;i++)runs.push(await runBacktestDate(dateDaysAgo(i),{limit}));
    const calibration=await recomputeCalibration();
    res.json({ok:true,runs,calibration})
  }catch(e){res.status(500).json({ok:false,error:String(e?.message||e)})}
}
