import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import webpush from "npm:web-push@3.6.7";
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const validPushEndpoint=(endpoint:string)=>{
 try{
  const u=new URL(endpoint);
  if(u.protocol!=="https:"||u.username||u.password||u.port||u.hash||u.searchParams.has("url"))return false;
  const h=u.hostname.toLowerCase();
  return h==="fcm.googleapis.com"||h==="updates.push.services.mozilla.com"||
    h==="web.push.apple.com"||h.endsWith(".notify.windows.com")||
    h.endsWith(".push.services.mozilla.com");
 }catch{return false;}
};
const brDate=(iso:string)=>new Date(iso).toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo"});
const norm=(s:unknown)=>String(s||"Movimentação bancária").replace(/\s+/g," ").trim().slice(0,84);
Deno.serve(async req=>{
 if(req.method!=="POST")return json({error:"method_not_allowed"},405);
 const url=Deno.env.get("SUPABASE_URL"),keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
 const key=keys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)return json({error:"server_config_missing"},500);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=req.headers.get("x-fina-sync-cron")||"";
 const check=await db.rpc("fina_verify_auto_sync_cron",{presented_token:token});
 if(check.error||check.data!==true)return json({error:"forbidden"},403);
 const k=await db.rpc("fina_push_service_keys");
 if(k.error||!k.data?.publicKey||!k.data?.privateKey)return json({error:"vapid_unavailable"},503);
 webpush.setVapidDetails("https://fina-html-v14.vercel.app/",String(k.data.publicKey),String(k.data.privateKey));
 const {data:subs,error:subErr}=await db.from("fina_push_subscriptions").select("id,user_id,endpoint,p256dh,auth,created_at").limit(300);
 if(subErr)return json({error:"subscriptions_unavailable"},500);
 let delivered=0,invalid=0,failed=0,inspected=0;
 for(const sub of subs||[]){
  if(!validPushEndpoint(String(sub.endpoint||""))){invalid++;continue;}
  const uid=String(sub.user_id);
  const {data:bank}=await db.from("fina_bank_accounts").select("id").eq("user_id",uid).eq("type","BANK");
  const bankIds=(bank||[]).map(a=>a.id);
  if(!bankIds.length)continue;
  const {data:txs,error:txErr}=await db.from("fina_bank_transactions")
   .select("id,description,amount,direction,category,status,occurred_at,created_at")
   .eq("user_id",uid).in("bank_account_id",bankIds).eq("status","POSTED")
   .gte("created_at",new Date(sub.created_at).toISOString())
   // Ignorar backfill histórico: data da transação deve ser recente, não só a data de importação.
   .gte("occurred_at",new Date(Date.now()-72*3600000).toISOString())
   // Priorizar movimentos novos; os 40 primeiros já enviados não devem bloquear os seguintes.
   .order("created_at",{ascending:false}).limit(100);
  if(txErr||!txs?.length)continue;
  const ids=txs.map(t=>t.id);
  const {data:sent}=await db.from("fina_push_deliveries").select("transaction_id")
    .eq("subscription_id",sub.id).in("transaction_id",ids);
  const already=new Set((sent||[]).map(r=>r.transaction_id));
  const {data:pairs}=await db.from("fina_couple_transfers")
   .select("sender_transaction_id,receiver_transaction_id")
   .or("sender_user_id.eq."+uid+",receiver_user_id.eq."+uid);
  const transfers=new Set((pairs||[]).flatMap(x=>[x.sender_transaction_id,x.receiver_transaction_id]).filter(Boolean));
  const {data:profile}=await db.from("fina_profiles").select("display_name").eq("user_id",uid).maybeSingle();
  const username=norm(profile?.display_name||"Você").slice(0,24);
  for(const t of txs){
   if(delivered>=120||inspected>=250)break;
   inspected++;
   if(already.has(t.id)||transfers.has(t.id))continue;
   if(/same person transfer|transfer-self|transfer-spouse/i.test(String(t.category||"")))continue;
   const amount=Number(t.amount);
   if(!Number.isFinite(amount)||amount<=0)continue;
   const line=username+": "+(t.direction==="credit"?"entrada ":"saída ")+
    new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(amount)+
    " · "+norm(t.description)+" · "+brDate(t.occurred_at);
   try{
    await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
      JSON.stringify({title:"FINA • Movimentação bancária",body:line,
        url:"/?fina=chat",tag:"fina-tx-"+t.id}),{TTL:3600,urgency:"normal"});
    const {error:saveErr}=await db.from("fina_push_deliveries").upsert({
      subscription_id:sub.id,transaction_id:t.id,sent_at:new Date().toISOString()
    },{onConflict:"subscription_id,transaction_id"});
    if(saveErr)failed++;else delivered++;
   }catch(err){
    const status=Number((err as any)?.statusCode||0);
    if(status===404||status===410){await db.from("fina_push_subscriptions").delete().eq("id",sub.id);invalid++;}
    else failed++;
    break;
   }
  }
 }

 // Alertas de saúde bancária: enviados uma vez por problema e por aparelho.
 // Não exigem movimentação nova; funcionam com o aplicativo fechado.
 let syncAlertsDelivered=0,syncAlertsFailed=0;
 for(const sub of subs||[]){
  if(!validPushEndpoint(String(sub.endpoint||"")))continue;
  const {data:alerts,error:alertErr}=await db.from("fina_sync_alerts")
    .select("id,message,kind").eq("user_id",sub.user_id).is("resolved_at",null)
    .order("first_detected_at",{ascending:true}).limit(20);
  if(alertErr||!alerts?.length)continue;
  const {data:seen,error:seenErr}=await db.from("fina_sync_alert_deliveries")
    .select("alert_id").eq("subscription_id",sub.id).in("alert_id",alerts.map(a=>a.id));
  if(seenErr)continue;
  const sentAlready=new Set((seen||[]).map(x=>x.alert_id));
  for(const alert of alerts){
    if(sentAlready.has(alert.id)||syncAlertsDelivered>=80)continue;
    try{
      await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
        JSON.stringify({title:"FINA • Atenção à sincronização bancária",
          body:String(alert.message||"Confira a sincronização do banco na FINA.").slice(0,200),
          tag:"fina-health-"+alert.id,url:"/?fina=home"}),{TTL:86400,urgency:"normal"});
      const {error:saveErr}=await db.from("fina_sync_alert_deliveries").upsert({
        alert_id:alert.id,subscription_id:sub.id,sent_at:new Date().toISOString()
      },{onConflict:"alert_id,subscription_id"});
      if(saveErr)syncAlertsFailed++;else syncAlertsDelivered++;
    }catch(err){
      const statusCode=Number((err as any)?.statusCode||0);
      if(statusCode===404||statusCode===410){
        await db.from("fina_push_subscriptions").delete().eq("id",sub.id);
        invalid++;
      }else syncAlertsFailed++;
      break;
    }
  }
 }
 return json({ok:true,subscribers:(subs||[]).length,inspected,delivered,failed,invalid,syncAlertsDelivered,syncAlertsFailed});
});