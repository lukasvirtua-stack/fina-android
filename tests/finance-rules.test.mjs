import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
function segment(from, to) {
  const start = html.indexOf(from);
  assert.notEqual(start, -1, 'Função ausente: ' + from);
  const end = html.indexOf(to, start + from.length);
  assert.notEqual(end, -1, 'Delimitador ausente: ' + to);
  return html.slice(start, end);
}
function run(code, expression, scope) {
  return vm.runInNewContext(code + '\n' + expression, scope, { timeout: 3000 });
}

test('Scripts embutidos têm sintaxe válida', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(x => x[1]).filter(x => x.trim());
  assert.ok(scripts.length >= 3);
  for (const script of scripts) new vm.Script(script, { filename: 'web/index.html' });
});

test('Casal soma saldos das duas pessoas; individual conserva seu saldo', () => {
  const code = segment('const coupleBaseBalance=', '\nconst monthKey=');
  const bank = { lucas: 68570, naara: 714 };
  for (const scope of ['casal', 'lucas', 'naara']) {
    const ctx = { S: { scope }, ownerBalance: o => bank[o],
      selfOwner: () => 'lucas', partnerOwner: () => 'naara', partnerReady: () => true };
    const result = run(code, '({ casal: coupleBaseBalance(), exibido: scopeBalance() })', ctx);
    assert.equal(result.casal, 69284);
    assert.equal(result.exibido, scope === 'casal' ? 69284 : bank[scope]);
  }
});

test('Pix/TED do casal contam só individualmente; transferências próprias nunca contam', () => {
  const code = segment('const finaCashIsInternal=', '\nconst finaCurrentCashTransactions=')
    + '\n' + segment('const finaCashCountable=', '\nconst real=');
  for (const scope of ['casal','lucas','naara']) {
    const ctx = { S:{scope},finaCoupleTransferTxIds:new Set(['pix-relacionado']) };
    const result = run(code, '({ propria:finaCashCountable({category:"transfer-self"}), propriaRaw:finaCashCountable({category:"Same person transfer"}), parceiro:finaCashCountable({category:"transfer-spouse"}), parceiroVinculado:finaCashCountable({id:"real-pix-relacionado",category:"bank"}), comum:finaCashCountable({category:"bank"}) })', ctx);
    assert.equal(result.propria, false);
    assert.equal(result.propriaRaw, false);
    assert.equal(result.parceiro, scope !== 'casal');
    assert.equal(result.parceiroVinculado, scope !== 'casal');
    assert.equal(result.comum, true);
  }
});

test('Snapshot do Casal exclui Pix entre integrantes; individuais preservam suas pontas', () => {
  const code = segment('const real=k=>{', '\nconst monthResult=');
  const snapshot = { userId:'u', ownerKey:'lucas', year:2026, month:10, transferKey:'',
    totals:{lucas:{in:240604,out:491361},naara:{in:239000,out:493795}},
    coupleTotals:{in:246604,out:752156}, coupleTransferPolicy:'individual-only' };
  for (const [scope, expectedIn, expectedOut] of [
    ['casal', 246604, 752156], ['lucas', 240604, 491361], ['naara', 239000, 493795]
  ]) {
    const ctx = { window:{FinaCurrentUser:{id:'u'},FinaCashTotalsByOwner:snapshot,FinaBankCacheState:'live'},
      S:{scope},finaCoupleTransferTxIds:new Set(),
      finaCurrentBankMonth:()=>({year:2026,month:10,day:13}),
      selfOwner:()=> 'lucas',partnerOwner:()=> 'naara',
      partnerReady:()=>true,ownerShown:()=>true };
    const results = run(code, '[real("in"),real("out")]', ctx);
    assert.equal(results[0], expectedIn);
    assert.equal(results[1], expectedOut);
  }
});

test('Cache antigo não impede a exclusão do Pix ao reconhecer vínculo depois', () => {
  const code = segment('const finaCashIsInternal=', '\nconst finaCurrentCashTransactions=')
    + '\n' + segment('const finaCashCountable=', '\nconst monthResult=');
  const S = {scope:'casal'};
  const bankMovements = [
    {id:'real-pix',category:'bank',kind:'out',value:233000},
    {id:'real-conta',category:'bank',kind:'out',value:752156}
  ];
  const snapshot = {userId:'u',ownerKey:'lucas',year:2026,month:10,
    transferKey:'',coupleTransferPolicy:'individual-only',coupleTotals:{out:985156}};
  const ctx = { S, window:{FinaCurrentUser:{id:'u'},FinaCashTotalsByOwner:snapshot,FinaBankCacheState:'cached'},
    finaCoupleTransferTxIds:new Set(['pix']),
    finaCurrentBankMonth:()=>({year:2026,month:10,day:13}),
    finaCurrentCashTransactions:()=>bankMovements,
    sum:(list,fn)=>list.reduce((total,x)=>total+fn(x),0),
    selfOwner:()=> 'lucas',partnerOwner:()=> 'naara',partnerReady:()=>true,ownerShown:()=>true };
  assert.equal(run(code,'real("out")',ctx),752156);
});

test('Cálculo bancário de Casal não acumula Pix entre integrantes', () => {
  assert.match(html, /if\(!betweenPartners\)cashCoupleTotals\[kind\]\+=amount;/);
  assert.match(html, /coupleTransferPolicy:'individual-only'/);
});

test('Resultado do Casal soma as duas projeções individuais', () => {
  const code = segment('const monthResult=', '\nconst ownerReserved=');
  const projected = { lucas: -42000, naara: 21000 };
  for (const scope of ['casal','lucas','naara']) {
    const ctx = { S:{scope},ownerProjected:o=>projected[o],
      selfOwner:()=> 'lucas',partnerOwner:()=> 'naara' };
    const actual = run(code, 'monthResult()', ctx);
    assert.equal(actual, scope === 'casal' ? -21000 : projected[scope]);
  }
});

test('Cache mantém extrato dos dois integrantes autorizados', () => {
  assert.match(html, /transactions:\(S\.transactions\|\|\[\]\)\.filter\(x=>x\.real===true&&\['lucas','naara'\]\.includes\(x\.owner\)&&ownerShown\(x\.owner\)\)/);
});

test('Contas, cartões e compromissos mantêm ordenação fixa', () => {
  const code=segment('const finaOwnerRank=', '\nconst seed=');
  const accounts=[
    {id:'b',owner:'naara',name:'Nubank',balance:7},
    {id:'a',owner:'lucas',name:'Santander',balance:600},
    {id:'c',owner:'lucas',name:'Itaú',balance:1},
    {id:'d',owner:'naara',name:'Bradesco',balance:0}
  ];
  const bills=[
    {id:'z',owner:'naara',name:'Condomínio',day:10,state:'open'},
    {id:'y',owner:'lucas',name:'Internet',day:10,state:'reserved'},
    {id:'x',owner:'naara',name:'Enel',day:5,state:'posted'}
  ];
  const x=run(code,'({ banks:accounts.slice().sort(finaBankSort).map(x=>x.id), bills:bills.slice().sort(finaBillSort).map(x=>x.id) })',{accounts,bills});
  assert.equal(x.banks.join(','),'c,a,d,b');
  assert.equal(x.bills.join(','),'x,y,z');
  bills[1].state='posted';
  const after=run(code,'bills.slice().sort(finaBillSort).map(x=>x.id)',{bills});
  assert.equal(after.join(','),'x,y,z','Pago/Reservado não deve mover a conta');
});

test('Atualização com dados iguais não recria telas nem perde a rolagem',()=>{
  const code=segment('function render(goTop=false){','\nfunction finaNormText(');
  let screenChanges=0,navChanges=0;
  const screen={scrollTop:75,set innerHTML(v){this.html=v;screenChanges++},get innerHTML(){return this.html}};
  const bottom={set innerHTML(v){this.html=v;navChanges++},get innerHTML(){return this.html}};
  const S={tab:'home',theme:'light',value:1};
  const ctx={
    S,screen,bottom,el:{classList:{toggle(){}}},window:{},document:{getElementById:()=>null},
    tabs:[['home','⌂','Início']],views:{home:()=>'<section>'+S.value+'</section>'},
    header:()=>'<header>FINA</header>',ensureCycle:()=>{},finaRecordHistoryView:()=>{},
    setTimeout:()=>0,clearTimeout:()=>{},finaRenderTimer:null,
    finaLastScreenMarkup:'',finaLastNavMarkup:''
  };
  run(code,'render(false);render(false);',ctx);
  assert.equal(screenChanges,1,'Um mesmo conteúdo não deve ser recriado');
  assert.equal(navChanges,1,'Navegação não deve piscar');
  assert.equal(screen.scrollTop,75);
  S.value=2;
  run(code,'render(false)',ctx);
  assert.equal(screenChanges,2);
  assert.equal(screen.scrollTop,75);
});

test('Últimos dados locais são isolados pelo Google e não apagam cache antes da identidade',()=>{
  assert.match(html,/const finaLocalUserStateKey=uid=>/);
  assert.match(html,/localStorage\.getItem\(finaLocalUserStateKey\(user\.id\)\)/);
  assert.match(html,/localStorage\.setItem\(finaLocalUserStateKey\(user\.id\),JSON\.stringify\(data\.state\)\)/);
  assert.doesNotMatch(html,/localStorage\.getItem\('fina_state_v1'\)/);
  assert.match(html,/if\(window\.FinaBankCacheState!=='live'\)window\.FinaRestoreCachedBankData/);
  assert.match(html,/finaRenderTimer=setTimeout/);
});

test('Ao abrir, não confundir saldo indisponível com zero ou previsão', () => {
 const source=segment('function home(){','\nfunction banks(){');
 assert.match(source,/const balancesAvailable=/);
 assert.match(source,/balancesAvailable\?display\(scopeBalance\(\)\):'—'/);
 assert.match(source,/!balancesAvailable\?'—':S\.showMoney/);
 assert.match(source,/cashAvailable\?monthResult\(\):null/);
 assert.match(source,/Carregando saldos reais dos bancos/);
 assert.match(html,/meta name="google" content="notranslate"/);
});

test('Consulta de saldos não espera histórico, perfis, fotos ou faturas', () => {
 const couple=segment('async function loadCoupleStatus(user){','\nfunction paintCouple(){');
 const trigger=couple.indexOf('void finaLoadEarlyBankBalances(user.id);void finaLoadRealBankData();');
 assert.ok(trigger>=0,'Consulta bancária não foi disparada após identificação do Google');
 const loadSlow=couple.indexOf('await finaLoadPersistentState(user);await finaLoadSharedBills();');
 assert.ok(loadSlow>trigger,'Consulta de banco está bloqueada por outras consultas');
 assert.match(couple,/window\.FinaOwnerResolvedForUserId=user\.id/);
});

test('Busca rápida mostra saldos autorizados e não acessa dados de outra sessão', async () => {
 const source=segment('let finaEarlyBalancesUser=null;','\nfunction finaSaveCachedBankData(user){');
 let reads=0,paints=0;
 const userId='login-1';
 const S={accounts:[]};
 const window={FinaCurrentUser:{id:userId},FinaOwnerResolvedForUserId:userId,
  FinaSelfOwnerKey:'lucas',FinaRealBankLoaded:false,FinaRender:()=>{paints++}};
 const sb={
  from:table=>{
    assert.equal(table,'fina_bank_accounts');
    reads++;
    return {
      select:()=>({
        eq:()=>({
          order:async()=>({
            data:[
              {id:'1',user_id:userId,institution_name:'ITAU',balance:685.70,number_last4:'1234'},
              {id:'2',user_id:'login-2',institution_name:'NUBANK',balance:7.14,number_last4:'5678'}
            ],
            error:null
          })
        })
      })
    };
  }
 };
 const ctx={S,window,sb,console,finaBankSort:(a,b)=>a.owner.localeCompare(b.owner)};
 await vm.runInNewContext(source+'\nfinaLoadEarlyBankBalances("login-1")',ctx,{timeout:3000});
 assert.equal(reads,1);
 assert.equal(paints,1);
 assert.equal(S.accounts.length,2);
 assert.equal(S.accounts.find(x=>x.owner==='lucas')?.balance,68570);
 assert.equal(S.accounts.find(x=>x.owner==='naara')?.balance,714);
 await vm.runInNewContext('finaLoadEarlyBankBalances("other-google")',ctx,{timeout:3000});
 assert.equal(reads,1,'Outra conta não pode consultar os saldos da sessão anterior');
});

test('Cache bancário restaura saldos reais entre os dois scripts isolados', () => {
 const browserModules=[...html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi)]
   .filter(x=>x[2].trim()&&!/\\bsrc=/.test(x[1]));
 assert.ok(browserModules.length>=3,'Os módulos inline devem estar presentes');
 const first=browserModules[1][2],second=browserModules[2][2];
 assert.match(first,/window\\.FinaBankSort=finaBankSort;/);
 assert.match(first,/window\\.FinaLocalUserStateKey=finaLocalUserStateKey;/);
 assert.match(second,/const finaBankSort=window\\.FinaBankSort;/);
 assert.match(second,/const finaLocalUserStateKey=window\\.FinaLocalUserStateKey;/);
 const c={window:{},S:{accounts:[],cards:[],transactions:[],bills:[],loans:[]},
   localStorage:{getItem:()=>null},Date};
 vm.createContext(c);
 // O primeiro módulo expõe os dois helpers; não estão no escopo global do segundo.
 vm.runInContext('(()=>{'+segment('const finaOwnerRank=', '\\nconst seed=')+
  "\\nconst finaLocalUserStateKey=uid=>'fina_user_state_v2_'+String(uid);"+
  '\\nwindow.FinaBankSort=finaBankSort;window.FinaLocalUserStateKey=finaLocalUserStateKey;})();',c,{timeout:1500});
 assert.equal(typeof c.window.FinaBankSort,'function');
 assert.equal(typeof c.window.FinaLocalUserStateKey,'function');
 const id='google-lucas';
 const saved={userId:id,ownerKey:'lucas',savedAt:Date.now(),
   accounts:[{id:'real-itau',owner:'lucas',real:true,name:'Itaú',balance:68570},
             {id:'real-nubank',owner:'naara',real:true,name:'Nubank',balance:714}],
   cards:[],transactions:[]};
 c.window.FinaCurrentUser={id};
 c.window.FinaOwnerResolvedForUserId=id;
 c.window.FinaSelfOwnerKey='lucas';
 c.window.FinaRender=()=>{};
 c.localStorage.getItem=key=>key==='fina_bank_snapshot_v5_'+id?JSON.stringify(saved):null;
 const restoreSource=segment('const finaBankCacheKey=uid=>','\\n// O saldo das contas chega antes do histórico');
 const result=vm.runInContext('(()=>{const finaBankSort=window.FinaBankSort;'+
   'const finaLocalUserStateKey=window.FinaLocalUserStateKey;'+
   restoreSource+'\\nreturn finaRestoreCachedBankData();})()',c,{timeout:3000});
 assert.equal(result,true,'Cache do celular deve restaurar sem ReferenceError');
 assert.equal(c.S.accounts.reduce((sum,x)=>sum+x.balance,0),69284);
 assert.equal(c.window.FinaBankCacheState,'cached');
 assert.equal(c.window.FinaLocalUserStateKey(id),'fina_user_state_v2_'+id);
});

test('Leitura bancária usa ordenação disponível no módulo de banco',()=>{
 const second=[...html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi)].filter(x=>x[2].trim()&&!/\\bsrc=/.test(x[1]))[2][2];
 const idx=second.indexOf('const finaBankSort=window.FinaBankSort;');
 assert.ok(idx>=0);
 assert.ok(second.indexOf('S.accounts=bankAccounts.map')>idx);
 assert.ok(second.indexOf('S.cards=creditAccounts.map')>idx);
 assert.match(second,/S\\.accounts=bankAccounts\\.map[\\s\\S]*?\\.sort\\(finaBankSort\\)/);
});
