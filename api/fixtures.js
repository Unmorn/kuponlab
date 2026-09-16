import { fixtures } from "../lib/core.js";
export const access="public";
export const methods=["GET"];
export default async function(req,res){const date=req.query.date||"";if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({ok:false,error:"Geçersiz tarih."});try{return res.json({ok:true,...await fixtures(date)})}catch(e){return res.status(502).json({ok:false,error:"Fikstür alınamadı. Veri kaynağı geçici olarak yanıt vermiyor.",detail:String(e?.message||e)})}}