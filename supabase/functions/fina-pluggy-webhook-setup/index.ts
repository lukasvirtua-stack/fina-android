import {createClient} from "npm:@supabase/supabase-js@2.49.8";
const allowed=new Set(["https://fina-html-v14.vercel.app","https://fina-git-auto.vercel.app"]);
const cors=(origin:string)=>({"access-control-allow-origin":allowed.has(origin)?origin:"https://fina-html-v14.vercel.app",
 "access-control-allow-headers":"authorization,apikey,content-type,x-client-info","access-control-allow-methods":"POST, OPTIONS","vary":"Origin"});
const json=(body:unknown,status:number,origin:string)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store",...cors(origin)}});
const hex=async(str:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(str)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const ub64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const utf8=new TextDecoder();
async function decrypt(cipher:string,iv:string,key:CryptoKey){
 const result=await crypto.subtle.decrypt({name:"AES-GCM",iv:ub64(iv)},key,ub64(cipher));
 return utf8.decode(result);
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin")||"";
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors(origin)});
 if(req.method!=="POST")return json({error:"method_not_allowed"},405,origin);
 if(origin&&!allowed.has(origin))return json({error:"origin_not_allowed"},403,origin);
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return json({error:"not_authenticated"},401,origin);
 const url=Deno.env.get("SUPABASE_URL")!;
 const serverKey=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default||
   Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const admin=createClient(url,serverKey,{auth:{persistSession:false}});
 const {data:auth,error:authError}=await admin.auth.getUser(token);
 if(authError||!auth?.user)return json({error:"not_authenticated"},401,origin);
 const uid=auth.user.id;
 const {count,error:itemErr}=await admin.from("fina_bank_items")
  .select("id",{head:true,count:"exact"}).eq("user_id",uid).eq("provider","pluggy");
 if(itemErr)return json({error:"bank_items_unavailable"},503,origin);
 if(!count)return json({status:"no_connections"},200,origin);
 let clientId=Deno.env.get("PLUGGY_CLIENT_ID")||"";
 let clientSecret=Deno.env.get("PLUGGY_CLIENT_SECRET")||"";
 const {data:credentials,error:credErr}=await admin.from("fina_pluggy_user_credentials")
  .select("client_id_cipher,client_id_iv,client_secret_cipher,client_secret_iv").eq("user_id",uid).maybeSingle();
 if(credErr)return json({error:"credentials_unavailable"},503,origin);
 if(credentials){
  try{
   const rawKey=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(serverKey));
   const key=await crypto.subtle.importKey("raw",rawKey,{name:"AES-GCM"},false,["decrypt"]);
   clientId=await decrypt(credentials.client_id_cipher,credentials.client_id_iv,key);
   clientSecret=await decrypt(credentials.client_secret_cipher,credentials.client_secret_iv,key);
  }catch{return json({error:"credentials_unavailable"},503,origin);}
 }
 if(!clientId||!clientSecret)return json({status:"pluggy_credentials_missing"},200,origin);
 const {data:existing,error:existingErr}=await admin.from("fina_pluggy_webhook_subscriptions")
  .select("status,updated_at,error_code").eq("client_id",clientId).maybeSingle();
 if(existingErr)return json({error:"registration_lookup_unavailable"},503,origin);
 if(existing?.status==="active")return json({status:"active"},200,origin);
 if(existing?.updated_at&&Date.now()-Date.parse(existing.updated_at)<(existing.status==="failed"?21600000:1800000))
  return json({status:existing.status,reason:existing.error_code||null},200,origin);
 const fresh=crypto.getRandomValues(new Uint8Array(32));
 const secret=btoa(String.fromCharCode(...fresh)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
 const hashed=await hex(secret);
 const {error:pendingErr}=await admin.from("fina_pluggy_webhook_subscriptions").upsert({
  client_id:clientId,created_by_user_id:uid,token_sha256:hashed,
  status:"registering",error_code:null,updated_at:new Date().toISOString()
 },{onConflict:"client_id"});
 if(pendingErr)return json({error:"registration_storage_unavailable"},503,origin);
 const fail=async(reason:string)=>{
  await admin.from("fina_pluggy_webhook_subscriptions").update({status:"failed",error_code:reason,updated_at:new Date().toISOString()})
   .eq("client_id",clientId).eq("token_sha256",hashed);
  return json({status:"failed",reason},200,origin);
 };
 let apiKey="";
 try{
  const a=await fetch("https://api.pluggy.ai/auth",{method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({clientId,clientSecret}),signal:AbortSignal.timeout(10000)});
  if(!a.ok)return await fail("pluggy_auth_http_"+a.status);
  const parsed=await a.json();apiKey=String(parsed?.apiKey||"");
  if(!apiKey)return await fail("pluggy_api_key_missing");
  const webhookEndpoint=url+"/functions/v1/fina-pluggy-webhook";
  const w=await fetch("https://api.pluggy.ai/webhooks",{method:"POST",headers:{"X-API-KEY":apiKey,"content-type":"application/json"},
   body:JSON.stringify({url:webhookEndpoint,event:"all",headers:{"X-FINA-PLUGGY-SECRET":secret}}),
   signal:AbortSignal.timeout(10000)});
  if(!w.ok)return await fail("webhook_http_"+w.status);
  const value=await w.json().catch(()=>({}));
  const {error:updatedErr}=await admin.from("fina_pluggy_webhook_subscriptions").update({
   provider_webhook_id:String(value?.id||value?.webhook?.id||"")||null,
   status:"active",error_code:null,updated_at:new Date().toISOString()
  }).eq("client_id",clientId).eq("token_sha256",hashed);
  if(updatedErr)return json({error:"registration_confirmation_unavailable"},503,origin);
  return json({status:"active"},200,origin);
 }catch{return await fail("provider_request_failed");}
});
