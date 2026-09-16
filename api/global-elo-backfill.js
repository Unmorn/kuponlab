import { processGlobalEloRange } from "../lib/global-elo.js";
export const access="admin";
export const methods=["POST"];
export default async function(req,res){
  const from=String(req.query.from||""),days=Math.max(1,Math.min(50,Number(req.query.days||7))),reset=String(req.query.reset||"0")==="1";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from))return res.status(400).json({ok:false,error:"Başlangıç tarihi geçersiz."});
  try{return res.json({ok:true,...await processGlobalEloRange(from,days,{reset,maxEvents:900})})}
  catch(e){return res.status(500).json({ok:false,error:String(e?.message||e)})}
}
