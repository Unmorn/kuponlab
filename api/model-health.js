import { validationReport, matchedVersionReport } from "../lib/backtest.js";
import { hasDatabase } from "../lib/db.js";
export const access="public";
export const methods=["GET"];
export default async function(req,res){
  if(!hasDatabase())return res.json({ok:true,database:"stateless",enabled:false,message:"Kalıcı model doğrulaması için Cloudflare D1 DB binding gerekir.",v5:{status:"disabled",matches:0},matched:{status:"disabled",matches:0}});
  try{
    const [v5,matched]=await Promise.all([validationReport("5.2"),matchedVersionReport("5.1","5.2")]);
    return res.json({ok:true,database:"d1",enabled:true,v5,matched})
  }catch(e){return res.status(502).json({ok:false,error:"Model sağlık raporu hazırlanamadı.",detail:String(e?.message||e)})}
}
