import { processGlobalEloDate } from "../lib/global-elo.js";
import { dateDaysAgo } from "../lib/backtest.js";
export const access="scheduler";
export const schedule="50 2 * * *";
export default async function(req,res){
  try{return res.json({ok:true,...await processGlobalEloDate(dateDaysAgo(1),{maxEvents:500})})}
  catch(e){return res.status(500).json({ok:false,error:String(e?.message||e)})}
}