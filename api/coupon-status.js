import { eventSnapshot } from "../lib/context.js";
export const access="public";
export const methods=["POST"];
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function w(){while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch(e){out[i]={eventId:String(items[i]),state:"unknown",completed:false,error:String(e?.message||e)}}}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>w()));return out
}
export default async function(req,res){
  const ids=[...new Set((req.body?.eventIds||[]).map(String).filter(Boolean))].slice(0,60);
  if(!ids.length)return res.json({ok:true,events:[]});
  try{
    const events=await mapLimit(ids,6,id=>eventSnapshot(id));
    return res.json({ok:true,events,checkedAt:new Date().toISOString()})
  }catch(e){return res.status(502).json({ok:false,error:"Kupon sonuçları alınamadı.",detail:String(e?.message||e)})}
}