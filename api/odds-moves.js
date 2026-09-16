import { db, hasDatabase } from "../lib/db.js";
export const access="public";
export const methods=["GET"];
export default async function(req,res){
  const date=String(req.query.date||""),group=String(req.query.group||"all"),limit=Math.max(5,Math.min(60,Number(req.query.limit||30)));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({ok:false,error:"Tarih geçersiz."});
  if(!hasDatabase())return res.json({ok:true,date,group,database:"stateless",enabled:false,tracked:0,rows:[],message:"Oran hareket geçmişi için Cloudflare D1 DB binding gerekir."});
  try{
    const dayStart=Math.floor(Date.parse(date+"T00:00:00+03:00")/1000),dayEnd=dayStart+86400;
    const params=[dayStart,dayEnd],where=[`match_ts >= $1`,`match_ts < $2`,`first_odd>1`,`last_odd>1`];
    if(group!=="all"){params.push(group);where.push(`market_group=$${params.length}`)}
    params.push(limit);
    const q=await db.query(`SELECT event_id,market_id,outcome_name,match_name,match_ts,market_name,market_key,market_group,
      first_odd,last_odd,min_odd,max_odd,first_seen_at,last_seen_at,change_count,model_probability,fair_probability,risk,
      ((last_odd-first_odd)/NULLIF(first_odd,0))*100 AS change_pct
      FROM iddaa_odds_history
      WHERE ${where.join(" AND ")}
      ORDER BY ABS((last_odd-first_odd)/NULLIF(first_odd,0)) DESC, last_seen_at DESC
      LIMIT $${params.length}`,params);
    const rows=(q.rows||[]).map(x=>{
      const model=x.model_probability==null?null:Number(x.model_probability),fair=x.fair_probability==null?null:Number(x.fair_probability),change=Number(x.change_pct||0),div=model!=null&&fair!=null?(model-fair)*100:null;
      return {eventId:String(x.event_id),marketId:String(x.market_id),match:x.match_name||"",matchTs:Number(x.match_ts||0),marketName:x.market_name||"",marketKey:x.market_key||"",group:x.market_group||"standard",pick:x.outcome_name||"",firstOdd:+Number(x.first_odd).toFixed(2),currentOdd:+Number(x.last_odd).toFixed(2),minOdd:+Number(x.min_odd).toFixed(2),maxOdd:+Number(x.max_odd).toFixed(2),changePct:+change.toFixed(1),changeCount:Number(x.change_count||0),modelProbability:model==null?null:+(model*100).toFixed(1),marketFair:fair==null?null:+(fair*100).toFixed(1),divergencePp:div==null?null:+div.toFixed(1),risk:x.risk==null?null:Number(x.risk),firstSeenAt:x.first_seen_at,lastSeenAt:x.last_seen_at}
    });
    return res.json({ok:true,date,group,database:"d1",enabled:true,tracked:rows.length,rows})
  }catch(e){return res.status(502).json({ok:false,error:"Oran hareketleri alınamadı.",detail:String(e?.message||e)})}
}
