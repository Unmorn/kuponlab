const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const LABELS={"1":"1","X":"X","2":"2","O25":"2.5 ÜST","U25":"2.5 ALT","BTTS":"KG VAR","NBTTS":"KG YOK"};
export const TITLES={"1":"Ev sahibi kazanır","X":"Beraberlik","2":"Deplasman kazanır","O25":"Toplam 2.5 Üst","U25":"Toplam 2.5 Alt","BTTS":"Karşılıklı gol var","NBTTS":"Karşılıklı gol yok"};

function riskFor(analysis,row){
  const conf=Number(analysis?.confidence||50),q=Number(analysis?.dataQuality||50),stability=Number(analysis?.stability||70),p=Number(row?.model||0)*100,edge=Number(row?.edge||0)*100,od=Number(row?.decimal||2);
  let r=100-(conf*.34+q*.25+p*.24+clamp(edge,-10,15)*.55);
  r+=Math.max(0,od-2)*6+(analysis?.riskFlags?.length||0)*2.5+Math.max(0,72-stability)*.24;
  return Math.round(clamp(r,8,92))
}
export function riskLabel(v){return v<=44?"Düşük":v<=60?"Orta":v<=75?"Yüksek":"Çok yüksek"}

export function pricedCandidates(analysis,comparison){
  if(!comparison?.available)return [];
  return comparison.rows.map(r=>withPlayability({
    key:r.key,label:LABELS[r.key]||r.key,title:TITLES[r.key]||r.key,
    probability:Math.round(Number(r.model)*100),model:Number(r.model),marketFair:Number(r.marketFair),
    edge:Number(r.edge),decimal:Number(r.decimal),openDecimal:r.openDecimal==null?null:Number(r.openDecimal),
    oddsMovePct:r.oddsMovePct==null?null:Number(r.oddsMovePct),risk:riskFor(analysis,r),
    family:["1","X","2"].includes(r.key)?"result":["O25","U25"].includes(r.key)?"goals":["BTTS","NBTTS"].includes(r.key)?"btts":"standard"
  }))
}
export function decorateAnalysis(analysis,comparison){
  const official=catalogIddaaCandidates(analysis),fallback=pricedCandidates(analysis,comparison),seen=new Set(),c=[];
  for(const x of [...official,...fallback]){const k=String(x.key||"");if(!k||seen.has(k))continue;seen.add(k);c.push(x)}
  const bestPriced=[...c].sort((a,b)=>(b.edge*120+b.probability-a.risk*.25)-(a.edge*120+a.probability-b.risk*.25))[0]||null;
  const stability=Number(analysis?.stability||70),bad=Number(analysis?.dataQuality||0)<55||Number(analysis?.confidence||0)<48||stability<52;
  const caution=Number(analysis?.dataQuality||0)<70||Number(analysis?.confidence||0)<62||stability<68||analysis?.signal==="Zayıf";
  const suitability=bad?{code:"skip",label:"Kupona uygun değil",reason:"Veri veya güven seviyesi yetersiz"}:caution?{code:"caution",label:"Temkinli",reason:"Sinyal var ama belirsizlik yüksek"}:{code:"good",label:"Kupona uygun",reason:"Veri ve güven seviyesi yeterli"};
  const safe=[...c].filter(x=>x.key!==bestPriced?.key).sort((a,b)=>b.probability-a.probability||a.risk-b.risk)[0]||null;
  const returner=[...c].filter(x=>x.key!==bestPriced?.key&&x.edge>=-.03).sort((a,b)=>b.decimal-a.decimal)[0]||null;
  return {suitability,bestPriced,pricedCandidates:c,iddaaCandidates:official,alternatives:{safer:safe,higherReturn:returner}}
}
function pickScore(x){return x.edge*145+x.probability*.42+Number(x.confidence||0)*.20+Number(x.dataQuality||0)*.12-x.risk*.36}
const IDDAA_FAMILIES=new Set(["result","goals","btts","standard","firstHalf","teamGoals","corners","shots","sot","cards","fouls","offsides","saves","playerShots","playerSot","playerGoals","playerAssists","playerCards","playerFouls","playerOffsides","playerSaves"]);
const IDDAA_COMBOS=new Set(["C_1_BTTS","C_2_BTTS","C_1_NBTTS","C_2_NBTTS","C_1_O15","C_2_O15","C_1_O25","C_2_O25","C_1_U35","C_2_U35"]);
function iddaaSupported(x){
  const f=String(x?.family||"");if(IDDAA_FAMILIES.has(f))return true;
  if(f==="combo")return IDDAA_COMBOS.has(String(x.key||""));
  if(/^HTFT_/.test(String(x.key||""))||/^CS_/.test(String(x.key||""))||/^TG(01|23|45|6P)$/.test(String(x.key||"")))return true;
  return false
}
function withPlayability(x){return {...x,iddaaStatus:iddaaSupported(x)?"market_type":"model_only",availabilityNote:iddaaSupported(x)?"İddaa market türü; bu maçta açılması programa göre değişebilir.":"Model marketi; İddaa'da aynı birleşim bulunmayabilir."}}
function exoticCandidates(analysis){
  const ex=analysis?.exotic||{},goals=(ex.goals||[]).filter(x=>["TG45","TG6P"].includes(x.key)),turn=(ex.htft||[]).filter(x=>["HTFT_1_2","HTFT_2_1","HTFT_X_1","HTFT_X_2","HTFT_1_X","HTFT_2_X"].includes(x.key)),scores=(ex.scorelines||[]).slice(0,5);
  return [...goals,...turn,...scores].filter(x=>Number(x.fairOdds)>=3.2&&Number(x.fairOdds)<=45&&Number(x.probabilityRaw)>=.02).map(x=>withPlayability({...x,decimal:Number(x.fairOdds),oddsType:"model_fair",edge:0,openDecimal:null,oddsMovePct:null}))
}
function broadCandidates(analysis){
  const wanted=new Set(["result","firstHalf","combo","corners","shots","discipline","saves","players"]),cats=analysis?.catalog?.categories||[],out=[];
  for(const c of cats)if(wanted.has(c.id))for(const x of c.items||[]){
    if(c.id==="result"&&x.family==="standard")continue;
    if(Number(x.sample||0)<3||Number(x.fairOdds||0)<1.15||Number(x.fairOdds||0)>8||Number(x.probability||0)<12)continue;
    if(c.id==="players"&&x.lineupStatus!=="İlk 11 onaylı")continue;
    if(Number(x.marketConfidence||50)<44)continue;
    out.push(withPlayability({...x,decimal:Number(x.fairOdds),oddsType:"model_fair",edge:0,openDecimal:null,oddsMovePct:null}))
  }
  return out
}
const profiles={
  low:{count:2,minRisk:0,maxRisk:46,minProb:58,minQ:68,minConf:55,minStability:72,minEdge:-.005,maxEdge:.16,minOdds:1.15,maxOdds:2.2,maxTotal:4.8},
  balanced:{count:3,minRisk:20,maxRisk:60,minProb:48,minQ:58,minConf:50,minStability:64,minEdge:-.01,maxEdge:.20,minOdds:1.15,maxOdds:3.2,maxTotal:14},
  high:{count:4,minRisk:52,maxRisk:88,minProb:12,minQ:48,minConf:44,minStability:50,minEdge:-1,maxEdge:1,minOdds:1.7,maxOdds:8,maxTotal:600},
  extreme:{count:3,minRisk:70,maxRisk:96,minProb:2,minQ:48,minConf:42,minStability:45,minEdge:-1,maxEdge:1,minOdds:3.2,maxOdds:45,maxTotal:5000},
  series5:{count:5,minRisk:0,maxRisk:52,minProb:52,minQ:55,minConf:44,minStability:62,minEdge:-.08,maxEdge:.24,minOdds:1.12,maxOdds:1.95,maxTotal:35},
  series8:{count:8,minRisk:0,maxRisk:56,minProb:48,minQ:50,minConf:42,minStability:58,minEdge:-.10,maxEdge:.28,minOdds:1.10,maxOdds:1.90,maxTotal:180},
  marathon13:{count:13,minRisk:0,maxRisk:62,minProb:44,minQ:45,minConf:40,minStability:54,minEdge:-.14,maxEdge:.32,minOdds:1.08,maxOdds:1.85,maxTotal:5000}
};
const themes=[
  {name:"Dengeli karışım",order:["result","goals","btts","corners","shots","saves","discipline","combo","player"]},
  {name:"Takım istatistiği",order:["corners","shots","discipline","saves","result","goals","combo","player"]},
  {name:"Oyuncu odaklı",order:["player","shots","saves","corners","combo","discipline","result","goals"]},
  {name:"Korner + kaleci",order:["saves","corners","shots","discipline","combo","result","goals","player"]},
  {name:"Kombine odaklı",order:["combo","goals","btts","result","saves","corners","shots","discipline","player"]}
];
function groupOf(x){
  const k=String(x?.key||""),f=String(x.family||"");if(["BTTS","NBTTS"].includes(k))return "btts";if(["1","X","2","DC_1X","DC_X2","DC_12"].includes(k))return "result";if(/^O\d|^U\d/.test(k)||/^TG/.test(k))return "goals";if(f.startsWith("player"))return "player";if(f==="sot")return "shots";if(["cards","fouls","offsides"].includes(f))return "discipline";if(["result","goals","btts","combo","corners","shots","saves"].includes(f))return f;if(f==="firstHalf"||f==="teamGoals")return "goals";return f||"standard"
}
function hash01(s){let h=2166136261;for(const ch of String(s)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return ((h>>>0)%10000)/10000}
function whyPick(x){
  const g=groupOf(x),n=Number(x.sample||0);
  if(g==="saves")return "Rakibin isabetli şut üretimi ile kaleci kurtarış profili birlikte destekliyor.";
  if(g==="corners")return "Takımların son maç korner üretimi ve rakibe verdiği kornerler bu çizgiyi destekliyor.";
  if(g==="shots")return "Son maç şut/isabetli şut temposu bu çizgi için yeterli sinyal veriyor.";
  if(g==="discipline")return "Kart/faul/ofsayt temposu son maç örneklerinde bu seviyeyi destekliyor.";
  if(g==="player")return (x.lineupStatus==="İlk 11 onaylı"?"İlk 11 onaylı · ":"")+n+" maçlık oyuncu olay profili bu seçimi destekliyor.";
  if(g==="combo")return "Skor dağılımında iki koşulun birlikte gerçekleşme olasılığı öne çıkıyor.";
  if(x.oddsType==="iddaa")return "Model olasılığı resmi İddaa oranı ve maçtaki açık marketle birlikte değerlendirildi.";
  if(x.oddsType==="market")return "Model olasılığı ile piyasa oranı birlikte değerlendirildi.";
  return "Model olasılığı bu marketi profil için uygun buldu."
}
function catalogIddaaCandidates(analysis){
  const out=[],cats=analysis?.catalog?.categories||[];
  for(const c of cats)for(const x of c.items||[]){
    const i=x?.iddaa;if(!i?.available||!(Number(i.odd)>1))continue;
    if(String(x.family||"").startsWith("player")&&x.lineupStatus!=="İlk 11 onaylı")continue;
    const fair=i.fairProbability==null?null:Number(i.fairProbability),hasFair=Number.isFinite(fair)&&fair>0,prob=Number(x.probabilityRaw??Number(x.probability||0)/100),edge=hasFair?prob-fair:0,mv=i.movement||null,g=groupOf(x),perf=analysis?.marketPerformance?.[g]||null;
    out.push({...x,marketGroup:g,performanceStatus:perf?.status||"Veri az",performanceN:Number(perf?.eventN||perf?.n||0),performanceAdj:Number(perf?.adjustment||0),decimal:Number(i.odd),oddsType:"iddaa",marketFair:hasFair?fair:null,edge:hasFair?edge:0,hasMarketFair:hasFair,openDecimal:mv?.firstOdd??null,oddsMovePct:mv?.changePct??null,iddaaStatus:"open",availabilityNote:"İddaa'da bu maç için açık.",iddaaEventId:i.eventId,iddaaMarketId:i.marketId,iddaaMarketName:i.marketName,iddaaOutcomeNo:i.outcomeNo??null,iddaaOutcomeName:i.outcomeName,mbs:i.mbs??analysis?.iddaa?.mbs??null,webOdd:i.webOdd??null})
  }
  return out
}
function mergeCandidates(primary,...rest){
  const seen=new Set(),out=[];
  for(const x of [...primary,...rest.flat()]){const k=String(x.key||"");if(!k||seen.has(k))continue;seen.add(k);out.push(x)}
  return out
}
function candidateSource(it,profileName){
  const iddaa=catalogIddaaCandidates(it.analysis),iddaaKeys=new Set(iddaa.map(x=>x.key));
  const priced=pricedCandidates(it.analysis,it.marketComparison).filter(x=>x.iddaaStatus==="market_type"&&!iddaaKeys.has(x.key));
  const broad=broadCandidates(it.analysis).filter(x=>x.iddaaStatus==="market_type"&&!iddaaKeys.has(x.key));
  const normal=mergeCandidates(iddaa,priced,broad);
  if(["series5","series8","marathon13"].includes(profileName))return normal.filter(x=>x.oddsType==="iddaa"||x.oddsType==="market"||["goals","combo","corners","shots","saves","discipline","player"].includes(groupOf(x)));
  if(profileName==="extreme")return mergeCandidates(iddaa.filter(x=>Number(x.decimal)>=3.2),exoticCandidates(it.analysis).filter(x=>x.iddaaStatus==="market_type"),broad.filter(x=>Number(x.decimal)>=3.2));
  if(profileName==="high")return normal;
  if(profileName==="low")return normal.filter(x=>x.oddsType!=="model_fair"||["corners","shots","saves","discipline"].includes(groupOf(x))&&Number(x.sample||0)>=4);
  if(profileName==="balanced")return normal.filter(x=>x.oddsType!=="model_fair"||Number(x.sample||0)>=3);
  return mergeCandidates(iddaa,priced)
}
function scoreCandidate(x,profileName,variant){
  const theme=themes[variant%themes.length],g=groupOf(x),idx=theme.order.indexOf(g),familyBonus=(idx<0?0:(theme.order.length-idx)*2.8),jitter=(hash01(String(x.event?.id)+"|"+x.key+"|"+variant)-.5)*8,sourceBonus=x.oddsType==="iddaa"?18:x.oddsType==="market"?5:0,perfBonus=clamp(Number(x.performanceAdj||0),-7,5);
  if(profileName==="high")return x.probability*.20+x.risk*.32+Math.min(x.decimal,8)*4.5+familyBonus+sourceBonus+perfBonus+jitter;
  if(profileName==="extreme")return x.probability*.40+x.risk*.18+Math.min(x.decimal,25)*1.15+familyBonus+sourceBonus+perfBonus*.5+jitter;
  if(["series5","series8","marathon13"].includes(profileName))return x.probability*1.02-x.risk*.58+x.edge*34+familyBonus*.95+sourceBonus+perfBonus+jitter*.45;
  return pickScore(x)+familyBonus+sourceBonus+perfBonus+jitter
}
function requiredGroups(profileName,variant){
  const v=variant%themes.length;
  if(profileName==="series5")return [["corners"],["shots"],["saves"],["discipline"],["corners","saves"]][v];
  if(profileName==="series8")return [["corners","shots"],["corners","saves"],["shots","discipline"],["saves","discipline"],["corners","shots","saves"]][v];
  if(profileName==="marathon13")return [["corners","shots","saves"],["corners","discipline","shots"],["saves","corners","discipline"],["shots","saves","discipline","player"],["corners","shots","saves","discipline"]][v];
  if(profileName==="extreme")return [];
  if(v===1)return ["corners"];if(v===2)return ["player"];if(v===3)return ["saves","corners"];if(v===4)return ["combo"];return []
}
function longRecipe(profileName,variant){
  const v=variant%themes.length;
  if(profileName==="series5")return ["Korner destekli","Şut destekli","Kaleci destekli","Kart/Faul destekli","Korner + kaleci"][v];
  if(profileName==="series8")return ["Korner + şut","Korner + kaleci","Şut + disiplin","Kaleci + disiplin","3 prop karışımı"][v];
  if(profileName==="marathon13")return ["Korner · şut · kaleci","Korner · kart · şut","Kaleci · korner · kart","Şut · kaleci · oyuncu","4 prop ailesi"][v];
  return "Düşük oran alternatifi "+(v+1)
}
export function smartCoupon(items,profileName="balanced",variant=0){
  const p=profiles[profileName]||profiles.balanced,all=[],isLong=["series5","series8","marathon13"].includes(profileName);
  for(const it of items){
    const source=candidateSource(it,profileName);
    const candidates=source.map(x=>{const marketGroup=groupOf(x),perf=it.analysis?.marketPerformance?.[marketGroup]||null;return {...x,event:it.event,confidence:it.analysis.confidence,dataQuality:it.analysis.dataQuality,stability:Number(it.analysis.stability||70),marketGroup,performanceStatus:x.performanceStatus||perf?.status||"Veri az",performanceN:Number(x.performanceN||perf?.eventN||perf?.n||0),performanceAdj:Number(x.performanceAdj??perf?.adjustment??0)}});
    let valid=candidates.filter(x=>x.risk>=p.minRisk&&x.risk<=p.maxRisk&&x.probability>=p.minProb&&it.analysis.dataQuality>=p.minQ&&it.analysis.confidence>=p.minConf&&Number(it.analysis.stability||70)>=p.minStability&&Number(x.edge||0)>=p.minEdge&&Number(x.edge||0)<=p.maxEdge&&x.decimal>=p.minOdds&&x.decimal<=p.maxOdds&&(!(x.oddsType==="iddaa"&&Number(x.mbs)>0)||Number(x.mbs)<=p.count));
    if(!valid.length&&profileName==="high")valid=candidates.filter(x=>x.risk>=48&&x.risk<=p.maxRisk+5&&x.decimal>=p.minOdds&&x.decimal<=p.maxOdds&&(!(x.oddsType==="iddaa"&&Number(x.mbs)>0)||Number(x.mbs)<=p.count));
    valid.sort((a,b)=>scoreCandidate(b,profileName,variant)-scoreCandidate(a,profileName,variant));
    if(isLong&&valid.length)all.push(...valid.slice(0,Math.min(3,valid.length)));
    else all.push(...valid.slice(0,4))
  }
  all.sort((a,b)=>scoreCandidate(b,profileName,variant)-scoreCandidate(a,profileName,variant));
  const officialMatchCount=new Set(all.filter(x=>x.oddsType==="iddaa").map(x=>String(x.event?.id))).size,playableOnly=officialMatchCount>=p.count,pool=playableOnly?all.filter(x=>x.oddsType==="iddaa"):all;
  const chosen=[],usedMatches=new Set(),familyCount=new Map(),leagueCount=new Map();let runningOdds=1;
  const leagueKey=x=>String(x.event?.tournament?.uniqueTournament?.id||x.event?.tournament?.uniqueTournament?.name||x.event?.tournament?.name||"other"),leagueCap=profileName==="marathon13"?4:profileName==="series8"?3:2;
  const add=(x,strictLeague=true)=>{if(!x||chosen.length>=p.count||usedMatches.has(String(x.event.id))||runningOdds*x.decimal>p.maxTotal)return false;const lk=leagueKey(x);if(strictLeague&&(leagueCount.get(lk)||0)>=leagueCap)return false;chosen.push(x);usedMatches.add(String(x.event.id));familyCount.set(x.marketGroup,(familyCount.get(x.marketGroup)||0)+1);leagueCount.set(lk,(leagueCount.get(lk)||0)+1);runningOdds*=x.decimal;return true};
  for(const g of requiredGroups(profileName,variant)){const x=pool.find(z=>z.marketGroup===g&&!usedMatches.has(String(z.event.id)));if(x)add(x,true)}
  const maxFamily=p.count<=3?1:2;
  for(const x of pool){if(chosen.length>=p.count)break;if((familyCount.get(x.marketGroup)||0)>=maxFamily)continue;add(x,true)}
  for(const x of pool){if(chosen.length>=p.count)break;add(x,true)}
  for(const x of pool){if(chosen.length>=p.count)break;add(x,false)}
  const picks=chosen.map(x=>({
    matchId:x.event.id,match:x.event.homeTeam.name+" - "+x.event.awayTeam.name,league:x.event.tournament?.uniqueTournament?.name||x.event.tournament?.name||"Futbol",
    startTimestamp:x.event.startTimestamp,marketKey:x.key,pick:x.label,probability:x.probability,decimal:x.decimal,openDecimal:x.openDecimal,oddsType:x.oddsType||"market",
    oddsMovePct:x.oddsMovePct,edge:+Number(x.edge||0).toFixed(4),risk:x.risk,confidence:x.confidence,dataQuality:x.dataQuality,stability:x.stability,marketFamily:x.family||null,marketGroup:x.marketGroup,side:x.side||null,player:x.player||null,lineupStatus:x.lineupStatus||null,sample:Number(x.sample||0),marketConfidence:Number(x.marketConfidence||0)||null,why:whyPick(x),iddaaStatus:x.iddaaStatus||"model_only",availabilityNote:x.availabilityNote||null,iddaaEventId:x.iddaaEventId||null,iddaaMarketId:x.iddaaMarketId||null,iddaaMarketName:x.iddaaMarketName||null,iddaaOutcomeNo:x.iddaaOutcomeNo??null,iddaaOutcomeName:x.iddaaOutcomeName||null,mbs:x.mbs??null,performanceStatus:x.performanceStatus||"Veri az",performanceN:Number(x.performanceN||0)
  }));
  const health=couponHealth(picks),mix={};for(const x of picks)mix[x.marketGroup]=(mix[x.marketGroup]||0)+1;
  const playerAvailable=pool.some(x=>x.marketGroup==="player"),notes=[],req=requiredGroups(profileName,variant);if(playableOnly)notes.push("Bu kupon yalnızca şu an İddaa'da açık gerçek oranlı marketlerden oluşturuldu.");if((variant%themes.length)===2&&!playerAvailable&&!isLong)notes.push("Oyuncu teması istendi ama ilk 11 onaylı yeterli oyuncu marketi bulunmadı.");for(const g of req)if(!mix[g])notes.push(({"corners":"Korner","shots":"Şut","saves":"Kaleci kurtarış","discipline":"Kart/Faul","player":"Oyuncu","combo":"Kombine"}[g]||g)+" marketi bu turda kalite/oran filtresini geçmedi; sistem zorla eklemedi.");if(!playableOnly)notes.push("Yeterli açık İddaa marketi bulunmadığı için bazı seçimler analiz fallback'inden gelebilir; kaynak etiketi kartta gösterilir.");
  return {profile:profileName,variant:Number(variant)||0,recipe:isLong?longRecipe(profileName,variant):themes[variant%themes.length].name,picks,mix,notes,...health,complete:picks.length>=p.count}
}
function customCandidatePool(it){
  const iddaa=catalogIddaaCandidates(it.analysis),iddaaKeys=new Set(iddaa.map(x=>x.key));
  const priced=pricedCandidates(it.analysis,it.marketComparison).filter(x=>x.iddaaStatus==="market_type"&&!iddaaKeys.has(x.key));
  const broad=broadCandidates(it.analysis).filter(x=>x.iddaaStatus==="market_type"&&!iddaaKeys.has(x.key));
  const seen=new Set(),out=[];
  for(const x of [...iddaa,...priced,...broad]){
    if(seen.has(x.key))continue;seen.add(x.key);
    const g=groupOf(x),sample=Number(x.sample||0),prob=Number(x.probability||0),risk=Number(x.risk||50),odds=Number(x.decimal||0);
    if(!Number.isFinite(odds)||odds<1.05||odds>12)continue;
    if(x.oddsType==="model_fair"&&sample>0&&sample<3)continue;
    if(g==="player"&&x.lineupStatus!=="İlk 11 onaylı")continue;
    if(prob<10||risk>92)continue;
    const perf=it.analysis?.marketPerformance?.[g]||null,stability=Number(it.analysis.stability||70);if(stability<50)continue;out.push({...x,event:it.event,confidence:it.analysis.confidence,dataQuality:it.analysis.dataQuality,stability,marketGroup:g,performanceStatus:x.performanceStatus||perf?.status||"Veri az",performanceN:Number(x.performanceN||perf?.eventN||perf?.n||0),performanceAdj:Number(x.performanceAdj??perf?.adjustment??0)})
  }
  return out
}
function customQuality(x,avgLeg,variant){
  const odds=Math.max(1.001,Number(x.decimal||1.01)),target=Math.max(1.001,avgLeg),distance=Math.abs(Math.log(odds)-Math.log(target));
  const q=Number(x.dataQuality||50),c=Number(x.confidence||50),st=Number(x.stability||70),prob=Number(x.probability||0),risk=Number(x.risk||50),real=x.oddsType==="iddaa"?10:x.oddsType==="market"?5:0,jitter=(hash01(String(x.event?.id)+"|"+x.key+"|C|"+variant)-.5)*4;
  return prob*.25+q*.13+c*.09+st*.09-risk*.25+real-distance*72+clamp(Number(x.performanceAdj||0),-7,5)+jitter
}
function customWhy(x,target,count){
  const base=whyPick(x),avg=Math.pow(Math.max(1.01,target),1/Math.max(1,count));
  return base+" "+count+" seçim / "+target+"x hedefinde gereken ortalama oran ~"+avg.toFixed(2)+"."
}
export function customCoupon(items,count=8,target=10,variant=0){
  const requestedCount=Math.round(clamp(Number(count)||8,2,20));target=clamp(Number(target)||10,1.5,5000);variant=Math.max(0,Math.round(Number(variant)||0));
  const avgLeg=Math.pow(target,1/requestedCount),prepared=[];
  for(const it of items){
    const opts=customCandidatePool(it).filter(x=>x.oddsType!=="iddaa"||!Number(x.mbs)||Number(x.mbs)<=requestedCount).sort((a,b)=>customQuality(b,avgLeg,variant)-customQuality(a,avgLeg,variant)).slice(0,4);
    if(opts.length)prepared.push({event:it.event,opts})
  }
  const realGroups=prepared.filter(g=>g.opts.some(x=>x.oddsType==="iddaa")),iddaaOnly=realGroups.length>=requestedCount,groups=(iddaaOnly?realGroups:prepared).map(g=>({...g,opts:iddaaOnly?g.opts.filter(x=>x.oddsType==="iddaa"):g.opts})),effectiveCount=Math.min(requestedCount,groups.length);
  const beam=24,targetLog=Math.log(target),states=Array.from({length:effectiveCount+1},()=>[]);
  states[0]=[{picks:[],logOdds:0,quality:0,families:{},leagues:{},fair:0,real:0}];
  const rankState=(s,k)=>{
    const progress=k/Math.max(1,effectiveCount),expected=targetLog*progress,dist=Math.abs(s.logOdds-expected),familyPenalty=Object.values(s.families).reduce((z,n)=>z+Math.max(0,n-Math.ceil(Math.max(1,effectiveCount)/3))*5,0),leaguePenalty=Object.values(s.leagues).reduce((z,n)=>z+Math.max(0,n-Math.ceil(Math.max(1,effectiveCount)/3))*4,0);
    return s.quality*.16-dist*170-familyPenalty-leaguePenalty
  };
  for(const g of groups){
    const next=states.map(a=>a.slice());
    for(let k=Math.min(effectiveCount-1,groups.length);k>=0;k--){
      for(const s of states[k]){
        for(const x of g.opts){
          const fam=x.marketGroup||"other",lg=String(x.event?.tournament?.uniqueTournament?.id||x.event?.tournament?.name||"other"),newLog=s.logOdds+Math.log(Math.max(1.001,Number(x.decimal||1.01)));
          const ns={picks:[...s.picks,x],logOdds:newLog,quality:s.quality+customQuality(x,avgLeg,variant)+(s.families[fam]?0:5),families:{...s.families,[fam]:(s.families[fam]||0)+1},leagues:{...s.leagues,[lg]:(s.leagues[lg]||0)+1},fair:s.fair+(x.oddsType==="model_fair"?1:0),real:s.real+(x.oddsType==="market"?1:0)};
          next[k+1].push(ns)
        }
      }
    }
    for(let k=0;k<=effectiveCount;k++)next[k]=next[k].sort((a,b)=>rankState(b,k)-rankState(a,k)).slice(0,beam);
    for(let k=0;k<=effectiveCount;k++)states[k]=next[k]
  }
  const finals=(states[effectiveCount]||[]).sort((a,b)=>{
    const da=Math.abs(a.logOdds-targetLog),db=Math.abs(b.logOdds-targetLog),divA=Object.keys(a.families).length,divB=Object.keys(b.families).length;
    return (db-da)*280+(divB-divA)*3+(b.quality-a.quality)*.04
  });
  const chosen=finals[Math.min(variant%Math.max(1,finals.length),Math.max(0,Math.min(4,finals.length-1)))]||finals[0]||{picks:[]};
  const picks=(chosen.picks||[]).map(x=>({matchId:x.event.id,match:x.event.homeTeam.name+" - "+x.event.awayTeam.name,league:x.event.tournament?.uniqueTournament?.name||x.event.tournament?.name||"Futbol",startTimestamp:x.event.startTimestamp,marketKey:x.key,pick:x.label,probability:x.probability,decimal:x.decimal,openDecimal:x.openDecimal,oddsType:x.oddsType||"model_fair",oddsMovePct:x.oddsMovePct,edge:+Number(x.edge||0).toFixed(4),risk:x.risk,confidence:x.confidence,dataQuality:x.dataQuality,stability:x.stability,marketFamily:x.family||null,marketGroup:x.marketGroup,side:x.side||null,player:x.player||null,lineupStatus:x.lineupStatus||null,sample:Number(x.sample||0),marketConfidence:Number(x.marketConfidence||0)||null,why:customWhy(x,target,requestedCount),iddaaStatus:x.iddaaStatus||"market_type",availabilityNote:x.availabilityNote||null,iddaaEventId:x.iddaaEventId||null,iddaaMarketId:x.iddaaMarketId||null,iddaaMarketName:x.iddaaMarketName||null,iddaaOutcomeNo:x.iddaaOutcomeNo??null,iddaaOutcomeName:x.iddaaOutcomeName||null,mbs:x.mbs??null,performanceStatus:x.performanceStatus||"Veri az",performanceN:Number(x.performanceN||0)}));
  const health=couponHealth(picks),achieved=picks.reduce((z,x)=>z*Math.max(1,Number(x.decimal||1)),1),delta=target?((achieved-target)/target)*100:0,mix={};for(const x of picks)mix[x.marketGroup]=(mix[x.marketGroup]||0)+1;
  const notes=[];if(picks.length<requestedCount)notes.push("İstenen "+requestedCount+" seçim için yalnızca "+picks.length+" kaliteli ve farklı maç bulundu.");if(Math.abs(delta)>12)notes.push("Hedef orana tam yaklaşacak kaliteli kombinasyon bulunamadı; en yakın seçenek gösteriliyor.");if(iddaaOnly)notes.push("Bu kupon yalnızca şu an İddaa'da açık gerçek oranlı marketlerden oluşturuldu.");else if(health.fairCount)notes.push("Yeterli gerçek İddaa marketi olmadığı için bazı seçimlerde model-adil fallback kullanıldı; toplam yaklaşık olabilir.");
  return {profile:"custom",variant,count:requestedCount,eligibleMatches:groups.length,target,avgLeg:+avgLeg.toFixed(2),achievedOdds:+achieved.toFixed(2),targetDeltaPct:+delta.toFixed(1),iddaaOnly,recipe:requestedCount+" maç · "+target+"x hedef",picks,mix,notes,...health,complete:picks.length===requestedCount}
}
export function targetCoupon(items,target=5,variant=0){
  const all=[];
  for(const it of items){
    const candidates=candidateSource(it,"series5").filter(x=>x.decimal>=1.08&&x.decimal<=2.25&&x.risk<=60&&x.probability>=46&&it.analysis.dataQuality>=48&&it.analysis.confidence>=40&&Number(it.analysis.stability||70)>=54);
    candidates.sort((a,b)=>((b.probability*1.2-b.risk*.75+Number(b.edge||0)*35+(b.oddsType==="iddaa"?18:b.oddsType==="market"?5:0))+(hash01(String(it.event.id)+"|"+b.key+"|T|"+variant)-.5)*7)-((a.probability*1.2-a.risk*.75+Number(a.edge||0)*35+(a.oddsType==="iddaa"?18:a.oddsType==="market"?5:0))+(hash01(String(it.event.id)+"|"+a.key+"|T|"+variant)-.5)*7));
    const best=candidates[variant%2]||candidates[0];if(best)all.push({...best,event:it.event,confidence:it.analysis.confidence,dataQuality:it.analysis.dataQuality,stability:Number(it.analysis.stability||70),marketGroup:groupOf(best)})
  }
  all.sort((a,b)=>((b.probability*1.2-b.risk*.75+b.edge*35)+(hash01(String(b.event.id)+"|"+b.key+"|TG|"+variant)-.5)*10)-((a.probability*1.2-a.risk*.75+a.edge*35)+(hash01(String(a.event.id)+"|"+a.key+"|TG|"+variant)-.5)*10));
  const official=all.filter(x=>x.oddsType==="iddaa"),canReachOfficial=official.slice(0,13).reduce((z,x)=>z*Number(x.decimal||1),1)>=target*.92,pool=canReachOfficial?official:all,chosen=[];let running=1;
  for(const x of pool){if(chosen.length>=13)break;chosen.push(x);running*=x.decimal;if(running>=target*.92&&chosen.length>=2)break}
  const picks=chosen.map(x=>({matchId:x.event.id,match:x.event.homeTeam.name+" - "+x.event.awayTeam.name,league:x.event.tournament?.uniqueTournament?.name||x.event.tournament?.name||"Futbol",startTimestamp:x.event.startTimestamp,marketKey:x.key,pick:x.label,probability:x.probability,decimal:x.decimal,openDecimal:x.openDecimal,oddsType:x.oddsType||"market",oddsMovePct:x.oddsMovePct,edge:+Number(x.edge||0).toFixed(4),risk:x.risk,confidence:x.confidence,dataQuality:x.dataQuality,stability:x.stability,marketFamily:x.family||null,marketGroup:x.marketGroup,why:"Hedef orana giderken düşük riskli ve oynanabilir seçimler arasından seçildi.",iddaaStatus:x.iddaaStatus||"model_only",iddaaEventId:x.iddaaEventId||null,iddaaMarketId:x.iddaaMarketId||null,iddaaMarketName:x.iddaaMarketName||null,iddaaOutcomeNo:x.iddaaOutcomeNo??null,iddaaOutcomeName:x.iddaaOutcomeName||null,mbs:x.mbs??null}));
  const health=couponHealth(picks);return {target:+target,achievedOdds:+running.toFixed(2),variant:Number(variant)||0,recipe:"Hedef oran · alternatif "+((Number(variant)||0)+1),picks,...health,reached:running>=target*.92}
}
export function couponHealth(picks=[]){
  let odds=1,priced=0,fairOdds=1,fairCount=0;for(const x of picks){if(Number(x.decimal)>1){if(x.oddsType==="model_fair"){fairOdds*=Number(x.decimal);fairCount++}else{odds*=Number(x.decimal);priced++}}}
  const warnings=[],byMatch=new Map(),maxMbs=picks.reduce((m,x)=>Math.max(m,Number(x.mbs||0)),0);
  picks.forEach(x=>{const k=String(x.matchId),a=byMatch.get(k)||[];a.push(x);byMatch.set(k,a)});
  let corr=0;
  for(const a of byMatch.values())if(a.length>1){
    const ks=new Set(a.map(x=>x.marketKey)),iddaaCount=a.filter(x=>x.oddsType==="iddaa").length;
    if(iddaaCount>1)warnings.push("Aynı maçtan birden fazla ayrı İddaa marketi var; resmi kombo değilse birlikte kabul edilmeyebilir.");
    if((ks.has("O25")&&ks.has("U25"))||(ks.has("BTTS")&&ks.has("NBTTS"))||[...["1","X","2"]].filter(k=>ks.has(k)).length>1){warnings.push("Aynı maçta birbiriyle çelişen seçim var");corr+=18}
    else if((ks.has("O25")&&ks.has("BTTS"))||(ks.has("U25")&&ks.has("NBTTS"))){warnings.push("Aynı maçta yüksek korelasyonlu seçimler var");corr+=12}
    else{warnings.push("Aynı maçtan birden fazla seçim var");corr+=8}
  }
  if(maxMbs>picks.length)warnings.push("MBS "+maxMbs+" nedeniyle bu kupon için en az "+maxMbs+" seçim gerekir.");
  const high=picks.filter(x=>Number(x.risk)>=65).length;if(high>=2)warnings.push(high+" yüksek riskli seçim birlikte");
  if(priced===picks.length&&odds>15)warnings.push("Toplam oran çok yüksek; kupon oynaklığı artar");if(fairCount===picks.length&&fairOdds>80)warnings.push("Model adil oran toplamı çok yüksek; bu profil çok düşük olasılıklıdır");
  const avg=picks.length?picks.reduce((s,x)=>s+Number(x.risk||50),0)/picks.length:0;
  const risk=Math.round(clamp(avg+Math.max(0,picks.length-2)*3+corr+(odds>10?5:0),0,95));
  const mixedTotal=priced>0&&fairCount>0&&priced+fairCount===picks.length?+(odds*fairOdds).toFixed(2):null;
  if(mixedTotal)warnings.push("Karma toplam yaklaşık değerdir; model-adil seçimler gerçek bookmaker oranı değildir.");
  return {totalOdds:priced===picks.length&&picks.length?+odds.toFixed(2):null,modelFairTotal:fairCount===picks.length&&picks.length?+fairOdds.toFixed(2):null,mixedTotal,pricedCount:priced,fairCount,maxMbs,mbsSatisfied:maxMbs<=picks.length,riskScore:risk,riskLabel:riskLabel(risk),warnings:[...new Set(warnings)]}
}
