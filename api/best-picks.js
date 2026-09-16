import { bestPicks } from "../lib/insights.js";
export const access="public";
export const methods=["GET"];
export default async function(req,res){
  const date=String(req.query.date||""),group=String(req.query.group||"all"),minOdds=Number(req.query.minOdds||1.2),maxOdds=Number(req.query.maxOdds||3),maxRisk=Number(req.query.maxRisk||65),minProb=Number(req.query.minProb||45),limit=Number(req.query.limit||20);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({ok:false,error:"Tarih geçersiz."});
  try{return res.json({ok:true,...await bestPicks(date,{group,minOdds,maxOdds,maxRisk,minProb,limit})})}
  catch(e){return res.status(502).json({ok:false,error:"En iyi seçimler hazırlanamadı.",detail:String(e?.message||e)})}
}