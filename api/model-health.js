import { validationReport, matchedVersionReport } from "../lib/backtest.js";
export const access="public";
export const methods=["GET"];
export default async function(req,res){
  try{
    const [v5,matched]=await Promise.all([validationReport("5.2"),matchedVersionReport("5.1","5.2")]);
    return res.json({ok:true,v5,matched})
  }catch(e){return res.status(502).json({ok:false,error:"Model sağlık raporu hazırlanamadı.",detail:String(e?.message||e)})}
}