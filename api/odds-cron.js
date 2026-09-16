import { refreshOddsHistory } from "../lib/iddaa.js";
export const access="scheduler";
export const schedule="20 */2 * * *";
export default async function(req,res){
  try{return res.json({ok:true,...await refreshOddsHistory(15)})}
  catch(e){return res.status(500).json({ok:false,error:String(e?.message||e)})}
}