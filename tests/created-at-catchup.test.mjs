import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const sync=readFileSync(new URL("../supabase/functions/fina-safe-auto-sync/index.ts",import.meta.url),"utf8");
const sql=readFileSync(new URL("../supabase/migrations/20261114120000_fina_createdat_catchup.sql",import.meta.url),"utf8");

test("API createdAtFrom is independent of posting date filters",()=>{
 assert.match(sync,/createdAtFrom=/);
 assert.match(sync,/created_at_catchup_checked_at/);
 assert.match(sync,/new Date\(Date\.now\(\)-7\*86400000\)/);
 assert.match(sync,/Math\.max\(Date\.now\(\)-72\*3600000,previous-3600000\)/);
 assert.match(sync,/if\(next\)return \{checked,saved,error:"created_at_pagination_incomplete"\}/);
 assert.match(sync,/const recent=await finaCatchUpByCreatedAt/);
 assert.match(sync,/created_at_catchup_error:recent\.error\|\|null/);
 assert.match(sql,/ADD COLUMN IF NOT EXISTS/i);
 assert.doesNotMatch(sql,/DELETE FROM|TRUNCATE|DROP TABLE/i);
});
function extractCatchup(){
 const start=sync.indexOf("async function finaCatchUpByCreatedAt(");
 const end=sync.indexOf("// O banco pode postar",start);
 assert.ok(start>0&&end>start);
 let text=sync.slice(start,end).replace(/:any\b|:string\b|:number\b/g,"").replace(/\|null/g,"");
 text=text.replace("const checkpoint:any=","const checkpoint=");
 text=text.replace("storedAccountId:string","storedAccountId").replace("providerAccountId:string","providerAccountId").replace("apiKey:string","apiKey");
 return text+"\nfinaCatchUpByCreatedAt;";
}
test("newly created provider transactions are imported by id once without synthesizing amounts",async()=>{
 const requested=[],upserted=[];
 const data={results:[
  {id:"tx-new",date:"2026-11-13T17:11:00.000Z",createdAt:"2026-11-14T13:00:00.000Z",
  amount:3000,status:"POSTED",description:"TED recebida"}
 ],next:null};
 const context={Date,Number,Math,String,Array,encodeURIComponent,
  fetch:async url=>{requested.push(new URL(url));return {ok:true,json:async()=>data}}};
 const fn=vm.runInNewContext(extractCatchup(),context);
 const admin={from:name=>({upsert:async rows=>{assert.equal(name,"fina_bank_transactions");
  upserted.push(...rows);return {error:null}}})};
 const result=await fn(admin,"owner","account","providerAccount","test-key",null);
 assert.equal(result.checked,1);
 assert.equal(result.saved,1);
 assert.equal(result.error,undefined);
 assert.equal(requested.length,1);
 assert.ok(requested[0].searchParams.has("createdAtFrom"));
 assert.equal(requested[0].searchParams.has("dateFrom"),false);
 assert.equal(requested[0].searchParams.has("dateTo"),false);
 assert.equal(upserted[0].amount,3000);
 assert.equal(upserted[0].direction,"credit");
 assert.equal(upserted[0].external_transaction_id,"tx-new");
 assert.equal(upserted[0].status,"POSTED");
});
test("partial pagination failure cannot look like a complete sync",async()=>{
 let count=0;
 const context={Date,Number,Math,String,Array,encodeURIComponent,
  fetch:async()=>{count++;return count===1?{ok:true,json:async()=>({
    results:[{id:"old",date:"2026-11-13T10:00:00Z",amount:17}],next:"?accountId=foo&after=token"
  })}:{ok:false,status:503}}};
 const fn=vm.runInNewContext(extractCatchup(),context);
 const admin={from:()=>({upsert:async()=>({error:null})})};
 const result=await fn(admin,"owner","acc","account","key",null);
 assert.equal(result.error,"created_at_http_503");
 assert.equal(result.saved,1);
 assert.equal(count,2);
});
test("fetched invalid or null amounts cannot turn into fake zero transactions",async()=>{
 const context={Date,Number,Math,String,Array,encodeURIComponent,
  fetch:async()=>({ok:true,json:async()=>({results:[{id:"bad",date:"2026-11-13",amount:null}],next:null})})};
 const fn=vm.runInNewContext(extractCatchup(),context);
 const admin={from:()=>({upsert:async()=>{throw Error("bad record should not be written")}})};
 const result=await fn(admin,"owner","acc","account","key",null);
 assert.equal(result.error,"created_at_invalid_record");
 assert.equal(result.saved,0);
});
