import { runBacktestDate, recomputeCalibration, dateDaysAgo } from "../lib/backtest.js";
export const access="scheduler";
export const schedule="20 4 * * *";
export default async function(req,res){
  try{
    const run=await runBacktestDate(dateDaysAgo(1),{limit:12});
    const calibration=await recomputeCalibration();
    res.json({ok:true,run,calibration})
  }catch(e){res.status(500).json({ok:false,error:String(e?.message||e)})}
}