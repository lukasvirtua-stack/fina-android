import {createClient} from "npm:@supabase/supabase-js@2.49.8";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const api=()=>createClient(Deno.env.get("SUPABASE_URL")!,
  JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {auth:{persistSession:false}});
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(v=>v.toString(16).padStart(2,"0")).join("");
const accepted=new Set(["item/updated","transactions/created","transactions/updated"]);
Deno.serve(async(req:Request)=>{
 if(req.method!=="POST")return json({error:"method_not_allowed"},405);
 const headerLength=Number(req.headers.get("content-length")||0);
 if(headerLength>8192)return json({error:"payload_too_large"},413);
 let payload:any;
 try{const body=await req.text();if(body.length>8192)return json({error:"payload_too_large"},413);payload=JSON.parse(body);}catch{return json({error:"invalid_json"},400);}
 const clientId=String(payload?.clientId||""),itemId=String(payload?.itemId||""),
       eventId=String(payload?.eventId||""),eventType=String(payload?.event||"");
 const token=req.headers.get("x-fina-pluggy-secret")||"";
 if(token.length<32||token.length>256||!clientId||clientId.length>128)return json({error:"unauthorized"},401);
 const admin=api();
 const tokenHash=await sha(token);
 const {data:subscription,error:subErr}=await admin.from("fina_pluggy_webhook_subscriptions")
   .select("client_id").eq("client_id",clientId).eq("token_sha256",tokenHash)
   .eq("status","active").maybeSingle();
 if(subErr)return json({error:"configuration_unavailable"},503);
 if(!subscription)return json({error:"unauthorized"},401);
 if(!accepted.has(eventType)||!itemId||itemId.length>128||!eventId||eventId.length>128)
   return json({accepted:false,reason:"unsupported_or_invalid_event"});
 // Nunca confiar no userId, valores ou transações vindos do webhook.
 const {data:bankItem,error:itemErr}=await admin.from("fina_bank_items")
   .select("user_id").eq("provider","pluggy").eq("external_item_id",itemId).maybeSingle();
 if(itemErr)return json({error:"item_lookup_unavailable"},503);
 if(!bankItem)return json({accepted:false,reason:"unregistered_item"});
 const {error:insertErr}=await admin.from("fina_pluggy_webhook_events").insert({
  client_id:clientId,event_id:eventId,user_id:bankItem.user_id,item_id:itemId,event_type:eventType,status:"pending"
 });
 if(insertErr?.code==="23505")return json({accepted:true,duplicate:true});
 if(insertErr)return json({error:"event_queue_unavailable"},503);
 await admin.from("fina_pluggy_webhook_subscriptions").update({last_event_at:new Date().toISOString()}).eq("client_id",clientId);
 // A Pluggy precisa receber 2xx em até 10 s; importação é assíncrona e idempotente.
 const process=fetch(Deno.env.get("SUPABASE_URL")!+"/functions/v1/fina-safe-auto-sync",{
   method:"POST",headers:{"content-type":"application/json","x-fina-pluggy-webhook-secret":token},
   body:JSON.stringify({clientId,itemId,eventId})
 }).catch(e=>console.warn("FINA webhook worker delayed",String(e).slice(0,80)));
 EdgeRuntime.waitUntil(process);
 return json({accepted:true,queued:true},202);
});
