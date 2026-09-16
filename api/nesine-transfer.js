import { prepareNesineTransfer } from "../lib/nesine-transfer.js";
export const access="public";
export const methods=["POST"];
export default async function(req,res){
  try{
    const picks=Array.isArray(req.body?.picks)?req.body.picks:[];
    if(!picks.length)return res.status(400).json({ok:false,error:"Kupon boş."});
    const data=await prepareNesineTransfer(picks);
    return res.json({ok:true,...data})
  }catch(e){return res.status(502).json({ok:false,error:"Nesine transferi hazırlanamadı.",detail:String(e?.message||e)})}
}