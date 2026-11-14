import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const _enc=new TextEncoder(),_dec=new TextDecoder();
const _ub64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function _aesKey(seed:string){const h=await crypto.subtle.digest("SHA-256",_enc.encode(seed));return crypto.subtle.importKey("raw",h,{name:"AES-GCM"},false,["decrypt"]);}
async function _open(cipher:string,iv:string,key:CryptoKey){const out=await crypto.subtle.decrypt({name:"AES-GCM",iv:_ub64(iv)},key,_ub64(cipher));return _dec.decode(out);}
async function _pluggyCreds(admin:any,userId:string,sec:string){
 const {data}=await admin.from("fina_pluggy_user_credentials").select("client_id_cipher,client_id_iv,client_secret_cipher,client_secret_iv").eq("user_id",userId).maybeSingle();
 if(!data)return {clientId:Deno.env.get("PLUGGY_CLIENT_ID"),clientSecret:Deno.env.get("PLUGGY_CLIENT_SECRET")};
 const key=await _aesKey(sec);
 return {clientId:await _open(data.client_id_cipher,data.client_id_iv,key),clientSecret:await _open(data.client_secret_cipher,data.client_secret_iv,key)};
}



// Provisão automática dos webhooks de todos os titulares que já autorizaram
// suas conexões na FINA. Apenas registra notificações; NÃO força atualização
// dos bancos e NÃO altera o calendário de 24 horas do Meu Pluggy.
// Executa no cron autenticado, jamais em chamada de webhook pública.
const finaHex=async(str:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",_enc.encode(str))))
  .map(v=>v.toString(16).padStart(2,"0")).join("");
async function finaAutoProvisionWebhook(admin:any,items:any[],sec:string,url:string){
 const seen=new Set<string>();
 for(const item of items){
  try{
   const {clientId,clientSecret}=await _pluggyCreds(admin,item.user_id,sec);
   if(!clientId||!clientSecret||seen.has(clientId))continue;
   seen.add(clientId);
   const {data:existing,error:lookupError}=await admin.from("fina_pluggy_webhook_subscriptions")
    .select("status,updated_at").eq("client_id",clientId).maybeSingle();
   if(lookupError)continue;
   if(existing?.status==="active")continue;
   // Evitar duplicatas, novas tentativas em cascata e re-registros desnecessários.
   const last=existing?.updated_at?Date.parse(existing.updated_at):NaN;
   const cooldown=existing?.status==="failed"?21600000:1800000;
   if(Number.isFinite(last)&&Date.now()-last<cooldown)continue;
   const bytes=crypto.getRandomValues(new Uint8Array(32));
   const secret=btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
   const hash=await finaHex(secret);
   const {error:storeError}=await admin.from("fina_pluggy_webhook_subscriptions").upsert({
    client_id:clientId,created_by_user_id:item.user_id,token_sha256:hash,
    status:"registering",error_code:null,updated_at:new Date().toISOString()
   },{onConflict:"client_id"});
   if(storeError)return "storage_failed";
   const fail=async(reason:string)=>{
    await admin.from("fina_pluggy_webhook_subscriptions").update({
     status:"failed",error_code:reason,updated_at:new Date().toISOString()
    }).eq("client_id",clientId).eq("token_sha256",hash);
    return reason;
   };
   try{
    const auth=await fetch("https://api.pluggy.ai/auth",{
     method:"POST",headers:{"content-type":"application/json"},
     body:JSON.stringify({clientId,clientSecret}),signal:AbortSignal.timeout(10000)});
    if(!auth.ok)return await fail("pluggy_auth_http_"+auth.status);
    const apiKey=String((await auth.json())?.apiKey||"");
    if(!apiKey)return await fail("pluggy_api_key_missing");
    const created=await fetch("https://api.pluggy.ai/webhooks",{
     method:"POST",headers:{"X-API-KEY":apiKey,"content-type":"application/json"},
     body:JSON.stringify({url:url+"/functions/v1/fina-pluggy-webhook",event:"all",
      headers:{"X-FINA-PLUGGY-SECRET":secret}}),signal:AbortSignal.timeout(10000)});
    if(!created.ok)return await fail("webhook_http_"+created.status);
    const provider=await created.json().catch(()=>({}));
    const {error:confirmed}=await admin.from("fina_pluggy_webhook_subscriptions").update({
     provider_webhook_id:String(provider?.id||provider?.webhook?.id||"")||null,
     status:"active",error_code:null,updated_at:new Date().toISOString()
    }).eq("client_id",clientId).eq("token_sha256",hash);
    if(confirmed)return "confirmation_failed";
    return "active";
   }catch{return await fail("provider_request_failed");}
  }catch{
   // A autenticação do usuário ou do provedor não pode quebrar o cron dos bancos.
   continue;
  }
 }
 return "already_registered";
}

const finaDatePart=(v:any)=>{const x=String(v||"");return /^\d{4}-\d{2}-\d{2}/.test(x)?x.slice(0,10):null;};
const safeDate=(v:unknown)=>typeof v==="string"&&v.length>5&&!Number.isNaN(Date.parse(v))?new Date(v).toISOString():null;
async function finaImportOfficialBills(admin:any,userId:string,storedAccountId:string,providerAccount:any,apiKey:string){
 const typ=String(providerAccount?.type||"").toUpperCase(),sub=String(providerAccount?.subtype||"").toUpperCase();
 if(typ!=="CREDIT"&&sub!=="CREDIT_CARD")return {saved:0};
 let saved=0,invalidBills=0;
 // Uma fatura perdida por paginação não pode ser registrada como sincronização completa.
 for(let page=1;page<=50;page++){
  const url="https://api.pluggy.ai/bills?accountId="+encodeURIComponent(String(providerAccount.id))+"&page="+page+"&pageSize=100";
  const response=await fetch(url,{headers:{"X-API-KEY":apiKey}});
  if(!response.ok)return {saved,error:"bills_unavailable_"+response.status};
  const data=await response.json();
  if(!Array.isArray(data?.results))return {saved,error:"bills_page_invalid"};
  const bills=data.results;
  // Salvar faturas válidas mesmo quando o provedor enviar outra incompleta.
  // Não converter totalAmount nulo ou vazio implicitamente para zero.
  const validBills=bills.filter((b:any)=>{
    const amount=b?.totalAmount;
    const valid=!!b?.id&&!!finaDatePart(b?.dueDate)&&amount!==null&&amount!==undefined&&amount!==""&&
      Number.isFinite(Number(amount))&&Number(amount)>=0;
    if(!valid)invalidBills++;
    return valid;
  });
  const rows=validBills.map((b:any)=>{
    const total=Math.round(Number(b.totalAmount)*100)/100;
    const payments=Array.isArray(b.payments)?b.payments:[];
    const paid=Math.round(payments.reduce((n:number,p:any)=>n+Math.max(0,Number(p?.amount)||0),0)*100)/100;
    return {user_id:userId,bank_account_id:storedAccountId,external_bill_id:String(b.id),
      due_date:finaDatePart(b.dueDate),closing_date:finaDatePart(b.billClosingDate),
      total_amount:total,paid_amount:Math.min(total,paid),
      currency_code:String(b.totalAmountCurrencyCode||"BRL").slice(0,8),
      synced_at:new Date().toISOString()};
  });
  if(rows.length){
   const {error}=await admin.from("fina_card_bills").upsert(rows,{onConflict:"user_id,external_bill_id"});
   if(error)return {saved,error:"bills_save_failed"};
   saved+=rows.length;
  }
  const totalPages=Math.max(1,Number(data?.totalPages)||1);
  if(!Number.isSafeInteger(totalPages))return {saved,error:"bills_page_count_invalid"};
  if(page>=totalPages)return invalidBills>0?{saved,warning:"bills_record_incomplete",invalidCount:invalidBills}:{saved,invalidCount:0};
  if(!bills.length)return {saved,error:"bills_page_empty_before_end"};
 }
 return {saved,error:"bills_pagination_incomplete"};
}


// O banco pode postar lançamentos de dias anteriores mesmo depois da virada do mês.
const finaRollingStart=(today:Date)=>{
 const monthStart=new Date(today.getFullYear(),today.getMonth(),1);
 const backfill=new Date(today.getFullYear(),today.getMonth(),today.getDate()-14);
 const start=backfill<monthStart?backfill:monthStart;
 return start.getFullYear()+"-"+String(start.getMonth()+1).padStart(2,"0")+"-"+String(start.getDate()).padStart(2,"0");
};

Deno.serve(async(req)=>{
  if(req.method!=="POST") return json({error:"method_not_allowed"},405);

  const supabaseUrl=Deno.env.get("SUPABASE_URL")!;
  const sec=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}").default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin=createClient(supabaseUrl,sec,{auth:{persistSession:false}});
  // Autorização separada: cron assinado OU aviso já registrado e autenticado.
  // O webhook só pode importar seu próprio Item registrado; nunca outro banco.
  let hook:{clientId:string,eventId:string,itemId:string,userId:string}|null=null;
  let cronAuthenticated=false;
  if(req.headers.has("x-fina-sync-cron")){
    const presentedToken=req.headers.get("x-fina-sync-cron")||"";
    const {data:authenticated,error:tokenError}=await admin.rpc("fina_verify_auto_sync_cron",{presented_token:presentedToken});
    if(tokenError||authenticated!==true)return json({error:"forbidden"},403);
    cronAuthenticated=true;
  }else{
    const secret=req.headers.get("x-fina-pluggy-webhook-secret")||"";
    if(secret.length<32||secret.length>256)return json({error:"forbidden"},403);
    let body:any;
    try{body=await req.json();}catch{return json({error:"invalid_json"},400);}
    const clientId=String(body?.clientId||""),eventId=String(body?.eventId||""),itemId=String(body?.itemId||"");
    if(!clientId||!eventId||!itemId||clientId.length>128||eventId.length>128||itemId.length>128)
      return json({error:"forbidden"},403);
    const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",_enc.encode(secret))))
      .map(x=>x.toString(16).padStart(2,"0")).join("");
    const {data:subscription,error:subscriptionErr}=await admin.from("fina_pluggy_webhook_subscriptions")
      .select("client_id").eq("client_id",clientId).eq("token_sha256",tokenHash).eq("status","active").maybeSingle();
    if(subscriptionErr||!subscription)return json({error:"forbidden"},403);
    const {data:event,error:eventErr}=await admin.from("fina_pluggy_webhook_events")
      .select("user_id").eq("client_id",clientId).eq("event_id",eventId)
      .eq("item_id",itemId).eq("status","pending").maybeSingle();
    if(eventErr)return json({error:"event_lookup_failed"},503);
    if(!event)return json({ok:true,duplicate:true});
    const {data:claimed,error:claimErr}=await admin.from("fina_pluggy_webhook_events")
      .update({status:"processing"}).eq("client_id",clientId).eq("event_id",eventId)
      .eq("status","pending").select("event_id").maybeSingle();
    if(claimErr)return json({error:"event_claim_failed"},503);
    if(!claimed)return json({ok:true,duplicate:true});
    hook={clientId,eventId,itemId,userId:String(event.user_id)};
  }


  const apiKeys=new Map<string,string>();
  const getApiKey=async(userId:string)=>{
    if(apiKeys.has(userId))return apiKeys.get(userId)!;
    const {clientId,clientSecret}=await _pluggyCreds(admin,userId,sec);
    if(!clientId||!clientSecret)return "";
    const r=await fetch("https://api.pluggy.ai/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({clientId,clientSecret})});
    if(!r.ok)return "";
    const j=await r.json().catch(()=>({}));
    const k=j?.apiKey||"";
    if(k)apiKeys.set(userId,k);
    return k;
  };

  let itemQuery=admin.from("fina_bank_items").select("*").eq("provider","pluggy");
  if(hook)itemQuery=itemQuery.eq("user_id",hook.userId).eq("external_item_id",hook.itemId);
  const {data:items,error:itemErr}=await itemQuery;
  if(itemErr) return json({error:"items_query_failed",detail:itemErr.message},500);
  // Registrar o webhook que faltava do outro titular, de forma independente do
  // navegador da pessoa e sem exigir um novo consentimento bancário.
  let webhookProvision="not_attempted";
  if(cronAuthenticated&&items?.length){
    webhookProvision=await finaAutoProvisionWebhook(admin,items,sec,supabaseUrl);
  }

  let accountsSaved=0,txSaved=0,itemsSynced=0,billsSaved=0,itemsImported=0,importFailures=0;
  let accountsScanned=0,accountsComplete=0,accountsFailed=0,accountListPages=0,transactionPages=0;
  const nowBr=new Date(new Date().toLocaleString("en-US",{timeZone:"America/Sao_Paulo"}));
  const y=nowBr.getFullYear(),m=String(nowBr.getMonth()+1).padStart(2,"0"),d=String(nowBr.getDate()).padStart(2,"0");
  const dateFrom=finaRollingStart(nowBr);
  const dateTo=y+"-"+m+"-"+d;
  // Somente agendas bancarias suportadas pela instituicao; nunca afetam Entrou/Saiu antes de POSTED.
  // Nao estender a janela de 12 meses das contas ainda em backfill retroativo.
  const futureEnd=new Date(Date.UTC(nowBr.getFullYear(),nowBr.getMonth(),nowBr.getDate()+90));
  const bankFutureDateTo=futureEnd.toISOString().slice(0,10);
  // Uma conta por execução: primeira importação retroativa, sem repetição ou PATCH de conexão bancária.
  const historyStart=new Date(nowBr);
  historyStart.setDate(historyStart.getDate()-364);
  const historyFrom=historyStart.getFullYear()+"-"+
    String(historyStart.getMonth()+1).padStart(2,"0")+"-"+
    String(historyStart.getDate()).padStart(2,"0");
  // Recheck the complete provider window periodically, even after initial 12-month import.
  // Limit scans per run so the free function stays within execution/time limits.
  let historyStartedThisRun=0,historyCompletedThisRun=0,historyPendingThisRun=0;
  const historyAuditCutoff=new Date(Date.now()-30*86400000).toISOString();
  const historyRetryCutoff=new Date(Date.now()-30*60000).toISOString();

  for(const item of items||[]){
    try{
      const apiKey=await getApiKey(item.user_id);
      if(!apiKey){importFailures++;await admin.from("fina_bank_items").update({last_import_error:"pluggy_auth_unavailable",last_import_count:0}).eq("id",item.id);continue;}
      const itemResp=await fetch("https://api.pluggy.ai/items/"+encodeURIComponent(item.external_item_id),{headers:{"X-API-KEY":apiKey}});
      if(!itemResp.ok){importFailures++;await admin.from("fina_bank_items").update({last_import_error:"pluggy_item_http_"+itemResp.status,last_import_count:0}).eq("id",item.id);continue;}
      const pi=await itemResp.json();
      await admin.from("fina_bank_items").update({
        status:pi.status||null,
        provider_execution_status:pi.executionStatus||null,
        provider_last_updated_at:safeDate(pi.lastUpdatedAt),
        provider_next_auto_sync_at:safeDate(pi.nextAutoSyncAt),
        last_provider_checked_at:new Date().toISOString(),
        consent_expires_at:safeDate(pi.consentExpiresAt),
        last_sync_at:new Date().toISOString()
      }).eq("id",item.id);
      // Uma consulta HTTP não comprova que o banco forneceu TEDs novos.
      itemsSynced++;
      let itemImportOk=true,itemImportErr="",itemImportedTx=0;
       // A fatura incompleta é alerta do provedor, não falha do extrato bancário.
       let itemBillsWarning:string|null=null,itemBillsInvalidCount=0;

      const ar=await fetch("https://api.pluggy.ai/accounts?itemId="+encodeURIComponent(item.external_item_id),{headers:{"X-API-KEY":apiKey}});
      if(!ar.ok){
        importFailures++;
        await admin.from("fina_bank_items").update({last_import_error:"pluggy_accounts_http_"+ar.status,last_import_count:0}).eq("id",item.id);
        continue;
      }
      const aj=await ar.json();
      const accounts=Array.isArray(aj?.results)?aj.results:Array.isArray(aj)?aj:[];
      // A primeira página não basta se a instituição disponibilizar muitas contas/cartões.
      accountListPages++;
      const morePages=Math.max(1,Number(aj?.totalPages)||1);
      for(let page=2;page<=morePages && page<=50;page++){
        const more=await fetch("https://api.pluggy.ai/accounts?itemId="+encodeURIComponent(item.external_item_id)+"&page="+page,{headers:{"X-API-KEY":apiKey}});
        if(!more.ok){itemImportOk=false;itemImportErr="accounts_page_http_"+more.status;break;}
        const payload=await more.json();
        if(!Array.isArray(payload?.results)){itemImportOk=false;itemImportErr="accounts_page_invalid";break;}
        accounts.push(...payload.results);
        accountListPages++;
      }
      if(morePages>50){itemImportOk=false;itemImportErr="accounts_pagination_incomplete";}
      if(accounts.length===0){itemImportOk=false;itemImportErr="pluggy_accounts_empty";}

      for(const a of accounts){
        accountsScanned++;
        let accountComplete=true;
        const accountRow={
          user_id:item.user_id,bank_item_id:item.id,external_account_id:String(a.id),
          institution_name:a.institution?.name||a.connector?.name||item.label||null,
          name:a.name||a.marketingName||a.type||"Conta",
          type:a.type||null,subtype:a.subtype||null,
          number_last4:String(a.number||a.accountNumber||"").replace(/\D/g,"").slice(-4)||null,
          balance:Number.isFinite(Number(a.balance))?Number(a.balance):null,
          currency_code:a.currencyCode||"BRL",
          credit_limit:Number.isFinite(Number(a.creditData?.creditLimit))?Number(a.creditData.creditLimit):null,
          available_credit_limit:Number.isFinite(Number(a.creditData?.availableCreditLimit))?Number(a.creditData.availableCreditLimit):null,
          updated_at:new Date().toISOString()
        };
        const {data:stored,error:ae}=await admin.from("fina_bank_accounts").upsert(accountRow,{onConflict:"user_id,external_account_id"}).select("id,history_backfilled_at,history_audit_verified_at,history_audit_last_attempt_at").single();
        if(ae||!stored){itemImportOk=false;itemImportErr="bank_account_save_failed";accountsFailed++;continue;}
        accountsSaved++;

        try{
          const billResult=await finaImportOfficialBills(admin,item.user_id,stored.id,a,apiKey);
          billsSaved+=billResult.saved||0;
           if(billResult.warning){itemBillsWarning=billResult.warning;itemBillsInvalidCount+=billResult.invalidCount||0;}
           if(billResult.error){itemImportOk=false;itemImportErr=billResult.error;accountComplete=false;}
        }catch{itemImportOk=false;itemImportErr="bill_exception";accountComplete=false;}

        // An audit replays ALL transactions Pluggy currently exposes for this product.
        // Previously, a successful first import permanently disabled historical checks,
        // so delayed/backdated records older than the 14-day rolling window were missed.
        const historical=historyStartedThisRun<3&&
          (!stored.history_backfilled_at||!stored.history_audit_verified_at||
           stored.history_audit_verified_at<historyAuditCutoff)&&
          (!stored.history_audit_last_attempt_at||
           stored.history_audit_last_attempt_at<historyRetryCutoff);
        if(historical){
          historyStartedThisRun++;historyPendingThisRun++;
          const {error:checkpointErr}=await admin.from("fina_bank_accounts")
            .update({history_audit_last_attempt_at:new Date().toISOString()}).eq("id",stored.id);
          if(checkpointErr){
            itemImportOk=false;itemImportErr="history_audit_attempt_failed";
            accountsFailed++;continue;
          }
        }
        const firstDate=historical?historyFrom:dateFrom;
        let fullHistoryOk=true,accountTransactionRows=0;
        const txDateTo=!historical&&String(a.type||"").toUpperCase()==="BANK"?bankFutureDateTo:dateTo;
        let next="?accountId="+encodeURIComponent(a.id)+"&dateFrom="+firstDate+"&dateTo="+txDateTo;
        for(let guard=0;guard<30&&next;guard++){
          const tr=await fetch("https://api.pluggy.ai/v2/transactions"+next,{headers:{"X-API-KEY":apiKey}});
          transactionPages++;
          if(!tr.ok){fullHistoryOk=false;itemImportOk=false;itemImportErr="transactions_http_"+tr.status;accountComplete=false;break;}
          const tj=await tr.json();
          // Nunca descartar silenciosamente uma transação inválida recebida do provedor.
          if(!Array.isArray(tj?.results)){
            fullHistoryOk=false;itemImportOk=false;itemImportErr="transactions_page_invalid";accountComplete=false;next="";break;
          }
          const txs=tj.results;
          if(txs.some((x:any)=>!x?.id||!x?.date||x.amount==null||
            !Number.isFinite(Number(x.amount))||Number.isNaN(Date.parse(String(x.date))))){
            fullHistoryOk=false;itemImportOk=false;itemImportErr="transactions_record_incomplete";accountComplete=false;next="";break;
          }
          accountTransactionRows+=txs.length;
          const rows=txs.map((x:any)=>{
            const n=Number(x.amount)||0;
            return {
              user_id:item.user_id,bank_account_id:stored.id,external_transaction_id:String(x.id),
              description:x.description||x.descriptionRaw||x.merchant?.name||"Movimentação",
              amount:Math.abs(n),direction:n>=0?"credit":"debit",
              occurred_at:new Date(x.date).toISOString(),category:x.category||null,status:x.status||null,raw:x,
              updated_at:new Date().toISOString()
            };
          });
          if(rows.length){
            const {error:te}=await admin.from("fina_bank_transactions").upsert(rows,{onConflict:"user_id,external_transaction_id"});
            if(!te){txSaved+=rows.length;itemImportedTx+=rows.length;}
            else{fullHistoryOk=false;itemImportOk=false;itemImportErr="transactions_save_failed";accountComplete=false;}
          }
          next=typeof tj?.next==="string"&&tj.next?tj.next:"";
        }
        if(next){fullHistoryOk=false;itemImportOk=false;itemImportErr="transactions_pagination_incomplete";accountComplete=false;}
        if(historical){
          const auditUpdate=fullHistoryOk?{
            history_backfilled_at:stored.history_backfilled_at||new Date().toISOString(),
            history_audit_verified_at:new Date().toISOString(),
            history_audit_last_error:null,history_audit_last_count:accountTransactionRows
          }:{
            history_audit_last_error:itemImportErr||"history_import_incomplete",
            history_audit_last_count:accountTransactionRows
          };
          const {error:markError}=await admin.from("fina_bank_accounts")
            .update(auditUpdate).eq("id",stored.id);
          if(!markError&&fullHistoryOk)historyCompletedThisRun++;
          else if(markError){accountComplete=false;itemImportOk=false;itemImportErr="history_checkpoint_failed";}
        }
        if(accountComplete)accountsComplete++;else accountsFailed++;
      }
      const result={last_import_error:itemImportOk?null:(itemImportErr||"import_incomplete"),
        last_import_count:itemImportedTx,last_bills_warning:itemBillsWarning,
        last_bills_invalid_count:itemBillsInvalidCount};
      if(itemImportOk)(result as any).last_import_success_at=new Date().toISOString();
      await admin.from("fina_bank_items").update(result).eq("id",item.id);
      if(itemImportOk)itemsImported++;else importFailures++;
      // Recupera eventos perdidos apenas após uma importação bancária completa.
      // Erros do provedor não viram movimentações fictícias ou atualizações forçadas.
      if(!hook&&itemImportOk){
        const completed={status:"complete",processed_at:new Date().toISOString(),error_code:null};
        const scope=()=>admin.from("fina_pluggy_webhook_events").update(completed)
          .eq("item_id",String(item.external_item_id)).eq("user_id",item.user_id);
        const {error:pendingError}=await scope().eq("status","pending");
        const {error:recoveredError}=await scope().eq("status","failed")
          .in("error_code",["bank_import_incomplete","cron_import_incomplete"]);
        const {error:staleError}=await scope().eq("status","processing")
          .lt("created_at",new Date(Date.now()-600000).toISOString());
        if(pendingError||recoveredError||staleError)
          console.warn("FINA: retry webhook status unavailable");
      }
    }catch(e){
      importFailures++;
      console.warn("FINA: falha isolada ao importar banco (sem interromper outros bancos)",String((e as Error)?.message||e).slice(0,110));
      await admin.from("fina_bank_items").update({last_import_error:"sync_exception",last_import_count:0}).eq("id",item.id);
    }
  }

  // Classify spouse transfers before financial reconciliation, avoiding a race with the 15-minute cron jobs.
  let pairedTransfers=0;
  try{
    const {data,error}=await admin.rpc("fina_refresh_couple_transfers");
    if(error)throw error;
    pairedTransfers=Number(data)||0;
  }catch(e){console.warn("FINA: could not refresh couple transfers before reconciliation",String((e as Error)?.message||e));}
  let reconciled=0;
  try{
    const {data,error}=await admin.rpc("fina_reconcile_manual_bills");
    if(error)throw error;
    reconciled=Number(data)||0;
  }catch(e){console.warn("FINA: automatic bill reconciliation unavailable",String((e as Error)?.message||e));}
  let financings=0;
  try{const {data}=await admin.rpc("fina_refresh_financings");financings=Number(data)||0;}catch{}
  try{await admin.rpc("fina_check_bank_sync_health");}catch{}
  if(hook){
    const complete=itemsImported===1&&importFailures===0&&accountsFailed===0;
    await admin.from("fina_pluggy_webhook_events").update({
      status:complete?"complete":"failed",processed_at:new Date().toISOString(),
      error_code:complete?null:"bank_import_incomplete"
    }).eq("client_id",hook.clientId).eq("event_id",hook.eventId).eq("status","processing");
  }
  return json({ok:importFailures===0 && accountsFailed===0,
    // "consultado" é diferente de "atualizado pelo banco": somente a Pluggy pode disponibilizar extratos novos.
    allConnectedProductsChecked:importFailures===0 && accountsFailed===0 && accountsScanned===accountsComplete,
    webhookProvision,items:itemsSynced,itemsImported,importFailures,
    accounts:accountsSaved,accountsScanned,accountsComplete,accountsFailed,accountListPages,transactionPages,
    transactions:txSaved,bills:billsSaved,pairedTransfers,reconciled,financings,
    historyStartedThisRun,historyCompletedThisRun,historyPendingThisRun,historyFrom,dateFrom,dateTo,
    sourceFreshness:"controlled_by_bank_and_pluggy",syncedAt:new Date().toISOString()});
});