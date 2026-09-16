import { dailyInsights } from "../lib/insights.js";
export const access="public";
export const methods=["GET"];
export default async function(req,res){
  const date=String(req.query.date||""),extended=String(req.query.extended||"")==="1";
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({ok:false,error:"Tarih geçersiz."});
  try{return res.json({ok:true,...await dailyInsights(date,{extended,baseUrl:new URL(req.url).origin})})}catch(e){return res.status(502).json({ok:false,error:"Günlük analiz hazırlanamadı.",detail:String(e?.message||e)})}
}