import { customInsights } from "../lib/insights.js";
export const access="public";
export const methods=["GET"];
export default async function(req,res){
  const date=String(req.query.date||""),count=Math.max(2,Math.min(20,Math.round(Number(req.query.count||8)))),target=Math.max(1.5,Math.min(5000,Number(req.query.target||10)));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({ok:false,error:"Tarih geçersiz."});
  try{return res.json({ok:true,...await customInsights(date,count,target,{baseUrl:new URL(req.url).origin})})}
  catch(e){return res.status(502).json({ok:false,error:"Özel kupon hazırlanamadı.",detail:String(e?.message||e)})}
}