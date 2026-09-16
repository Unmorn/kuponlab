import { scanUpcomingLineups } from "../lib/lineup.js";
export const access="scheduler";
export const schedule="5 * * * *";
export default async function(req,res){
  try{return res.json({ok:true,...await scanUpcomingLineups({minutes:180,limit:12})})}
  catch(e){return res.status(500).json({ok:false,error:String(e?.message||e)})}
}