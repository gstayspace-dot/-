const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const ts=require(process.env.CARD_TEST_TYPESCRIPT || '../../node_modules/typescript');
const base=process.env.CARD_TEST_BASE || __dirname;let passed=0;
const fakeEnv={PAYAPP_USER_ID:'fixture-shop',PAYAPP_LINK_KEY:'fixture-key',PAYAPP_LINK_VALUE:'fixture-value',PAYAPP_ENABLED:'true',NODE_ENV:'test'};
function compile(file,imports,extra={}) {
 const m={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(base,file),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
 assert.equal((code.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
 vm.runInNewContext(code.outputText,{module:m,exports:m.exports,require:n=>{if(n in imports)return imports[n];throw Error('unexpected import '+n)},Request,Response,URL,URLSearchParams,AbortSignal,Buffer,Date,process:{env:fakeEnv},console:{error(){}},...extra});return m.exports;
}
class NextResponse extends Response {static json(body,init){return Response.json(body,init)}}
const next={'next/server':{NextResponse}};
const payapp=compile('current/lib/payapp.ts',{'node:crypto':require('node:crypto')});
function fixture(options={}) {
 const orders=new Map(),allItems=[];let providerCalls=0,notifications=0,quoteCalls=0,params;
 const product={product_id:'22222222-2222-4222-8222-222222222222',product_name:'테스트 냄비',quantity:1,price:20000};
 function from(table){let action='read',values,filters=[];const q={insert:v=>{action='insert';values=v;return q},update:v=>{action='update';values=v;return q},delete:()=>{action='delete';return q},select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q},is:(k,v)=>{filters.push([k,v]);return q},single:()=>exec(true),maybeSingle:()=>exec(true),then:(ok,bad)=>exec(false).then(ok,bad)};
  async function exec(single){
   if(action==='insert'){
    if(table==='orders'){const v={id:'33333333-3333-4333-8333-333333333333',created_at:new Date().toISOString(),payment_key:null,payment_confirmed_at:null,...values};if(orders.has(v.id))return{error:{code:'23505'},data:null};orders.set(v.id,v);return{error:null,data:{...v}};}
    if(options.itemError)return{error:{code:'fixture'},data:null};allItems.push(...values);return{error:null,data:values};
   }
   const rows=table==='orders'?[...orders.values()]:allItems;const selected=rows.filter(o=>filters.every(([k,v])=>o[k]===v));
   if(action==='update'){if(options.paymentSaveError&&values.payment_key)return{error:{code:'fixture'},data:null};for(const o of selected)Object.assign(o,values);}
   if(action==='delete')for(const o of selected)orders.delete(o.id);
   return{error:null,data:single?(selected[0]?{...selected[0]}:null):selected.map(x=>({...x}))};
  }return q;
 }
 const db={supabase:{from},fetchOrderItemsForOrders:async()=>({data:allItems,error:null})};
 const gateway=compile('patch/lib/payapp-request.ts',{...next,'@/lib/supabaseClient':db,'@/lib/payapp':payapp},{fetch:async(url,init)=>{
  assert.equal(url,'https://api.payapp.kr/oapi/apiLoad.html');providerCalls++;params=new URLSearchParams(init.body);
  if(options.timeout)throw Error('fixture uncertain response');
  return new Response(options.reject?'state=0':'state=1&mul_no=123456&payurl='+encodeURIComponent(options.badUrl?'https://evil.test/pay':'https://www.payapp.kr/fixture-payment'),{status:200});
 }});
 const cash={receiptSummaries:async()=>new Map(),receiptSummary:async()=>null};
 const notificationsModule=compile('patch/lib/order-notification.ts',{...next,'@/lib/supabaseClient':db,'@/lib/payapp':payapp,'@/lib/business-info':{BANK_INFO:{name:'테스트은행',account:'FIXTURE-ACCOUNT',holder:'테스트'},BUSINESS_INFO:{shortName:'시험몰'}},'@/lib/sms':{ADMIN_PHONE:'',normalizePhone:x=>x.replace(/\D/g,''),smsConfigured:()=>true,sendSms:async messages=>{notifications++;return messages;}}});
 const shipping={'@/lib/shipping-server':{quoteAdminShippingCart:async()=>{quoteCalls++;return{items:[product],total:options.total??24000,groups:[]}},ShippingError:class extends Error{}}};
 const route=compile('patch/app/api/admin/orders/legacy.ts',{...next,...shipping,'@/lib/payapp':payapp,'@/lib/payapp-request':gateway,'@/lib/receipt-admin-auth':{receiptAdmin:async()=>options.auth!==false},'@/lib/cash-receipt':cash,'@/lib/order-notification':notificationsModule,'@/lib/supabaseClient':db});
 const feedback=compile('current/app/api/payapp/feedback/route.ts',{...next,'@/lib/supabaseClient':db,'@/lib/payapp':payapp,'@/lib/cash-receipt':cash,'@/lib/marketing/server':{recordMarketingPayment:async()=>{}}});
 const status=compile('current/app/api/payapp/status/route.ts',{...next,'@/lib/supabaseClient':db,'@/lib/payapp':payapp});
 const id='11111111-1111-4111-8111-111111111111';
 const body={name:'시험 고객',phone:'01000000000',address:'시험 배송지',request:'배송 요청',skipSms:false,expectedTotal:options.total??24000,items:[{productId:product.product_id,quantity:1}],paymentMethod:'card',cardRequestId:id};
 return{orders,allItems,id,body,state:()=>({providerCalls,notifications,quoteCalls,params}),call:body=>route.POST(new Request('https://xn--oi2bm5bw2c73c.com/api/admin/orders',{method:'POST',headers:{'Content-Type':'application/json',Origin:options.origin??'https://xn--oi2bm5bw2c73c.com'},body:JSON.stringify(body)})),
 notify:(id,options)=>notificationsModule.notifyOrder(new Request('https://fixture.test',{method:'POST',body:JSON.stringify({orderId:id})}),options),
 callback:async(overrides={})=>{const form=new FormData();const obj={userid:fakeEnv.PAYAPP_USER_ID,linkkey:fakeEnv.PAYAPP_LINK_KEY,linkval:fakeEnv.PAYAPP_LINK_VALUE,var1:id,var2:payapp.payappToken('payment',id,options.total??24000),mul_no:'123456',pay_state:'4',price:String(options.total??24000),pay_type:'1',...overrides};for(const[k,v]of Object.entries(obj))form.set(k,v);return feedback.POST(new Request('https://fixture.test/api/payapp/feedback',{method:'POST',body:form}));},
 status:()=>status.GET(new Request('https://fixture.test/api/payapp/status?id='+id+'&token='+payapp.payappToken('return',id,options.total??24000)))};
}
async function test(name,run){await run();passed++;console.log('PASS '+name)}
(async()=>{
 await test('legacy cash registration and bank SMS unchanged; no PayApp calls',async()=>{const f=fixture();const b={...f.body};delete b.paymentMethod;delete b.cardRequestId;const r=await f.call(b);assert.equal(r.status,201);const d=await r.json();assert.equal(d.order.status,'입금대기');assert.equal(d.payment,undefined);assert.equal(f.state().providerCalls,0);const n=await f.notify(d.order.id);const sms=(await n.json()).results[0];assert.ok(sms.text.includes('FIXTURE-ACCOUNT'));});
 await test('card saves unpaid order, returns link and card-only provider request',async()=>{const f=fixture();const r=await f.call(f.body);assert.equal(r.status,201);const d=await r.json();assert.equal(d.payment.payurl,'https://www.payapp.kr/fixture-payment');assert.equal(f.orders.get(f.id).status,'결제대기');assert.equal(f.orders.get(f.id).payment_confirmed_at,null);assert.equal(f.state().params.get('openpaytype'),'card');assert.equal(f.state().params.get('price'),'24000');assert.equal(f.state().params.get('smsuse'),'n');assert.equal(f.state().params.get('checkretry'),'y');assert.equal(f.state().params.get('feedbackurl'),'https://xn--oi2bm5bw2c73c.com/api/payapp/feedback');const n=await f.notify(f.id,{cardPayurl:d.payment.payurl});const sms=(await n.json()).results[0];assert.ok(sms.text.includes(d.payment.payurl));assert.ok(!sms.text.includes('FIXTURE-ACCOUNT'));});
 await test('duplicate concurrent card submission makes exactly one request',async()=>{const f=fixture();const responses=await Promise.all([f.call(f.body),f.call(f.body)]);assert.deepEqual(responses.map(x=>x.status).sort(),[201,409]);assert.equal(f.state().providerCalls,1);assert.equal(f.state().notifications,1);assert.equal(f.orders.size,1);});
 await test('skip SMS does not disable card link',async()=>{const f=fixture();const d=await(await f.call({...f.body,skipSms:true})).json();assert.ok(d.payment.payurl);assert.equal(f.state().notifications,0);});
 await test('uncertain response never repeats gateway call or marks paid',async()=>{const f=fixture({timeout:true});const d=await(await f.call(f.body)).json();assert.equal(d.payment.pending,true);assert.equal(d.sms.sent,false);assert.equal((await f.call(f.body)).status,409);assert.equal(f.state().providerCalls,1);assert.equal(f.orders.get(f.id).status,'결제대기');});
 await test('provider rejection retains order and does not send cash SMS',async()=>{const f=fixture({reject:true});const d=await(await f.call(f.body)).json();assert.equal(d.payment.retrySafe,false);assert.equal(f.state().notifications,0);assert.equal(f.orders.get(f.id).status,'결제요청실패');});
 await test('untrusted provider URL is never returned or messaged',async()=>{const f=fixture({badUrl:true});const d=await(await f.call(f.body)).json();assert.equal(d.payment.payurl,undefined);assert.equal(f.state().notifications,0);});
 await test('failed item write occurs before any gateway request',async()=>{const f=fixture({itemError:true});assert.equal((await f.call(f.body)).status,500);assert.equal(f.state().providerCalls,0);});
 for(const [name,opt,change,code]of [['authentication',{auth:false},{},401],['origin',{origin:'https://evil.test'},{},403],['server price',{}, {expectedTotal:1},409],['minimum',{total:999},{},400],['phone',{}, {phone:'0212345678'},400],['request ID',{}, {cardRequestId:'bad'},400],['payment enum',{}, {paymentMethod:'cash;paid'},400]])await test(name+' rejected before order/payment',async()=>{const f=fixture(opt);assert.equal((await f.call({...f.body,...change})).status,code);assert.equal(f.state().providerCalls,0);assert.equal(f.orders.size,0);});
 await test('initial request callback and redirect never mark paid; approval does',async()=>{const f=fixture();await f.call(f.body);assert.equal(await(await f.callback({pay_state:'1'})).text(),'SUCCESS');assert.equal((await(await f.status()).json()).paid,false);assert.equal(await(await f.callback()).text(),'SUCCESS');assert.equal(f.orders.get(f.id).status,'결제완료');assert.ok(f.orders.get(f.id).payment_confirmed_at);assert.equal((await(await f.status()).json()).paid,true);});
 for(const [name,override]of [['credentials',{linkkey:'wrong'}],['amount',{price:'1'}],['signature',{var2:'wrong'}],['transaction',{mul_no:'999999'}]])await test('callback '+name+' mismatch does not approve',async()=>{const f=fixture();await f.call(f.body);assert.ok((await f.callback(override)).status>=400);assert.equal(f.orders.get(f.id).status,'결제대기');});
 await test('duplicate approval preserves timestamp and delivery status',async()=>{const f=fixture();await f.call(f.body);await f.callback();const time=f.orders.get(f.id).payment_confirmed_at;f.orders.get(f.id).status='배송중';await f.callback();assert.equal(f.orders.get(f.id).payment_confirmed_at,time);assert.equal(f.orders.get(f.id).status,'배송중');});
 await test('cancel then late approval cannot revert cancelled order',async()=>{const f=fixture();await f.call(f.body);await f.callback();await f.callback({pay_state:'8'});assert.equal(f.orders.get(f.id).status,'결제취소');await f.callback();assert.equal(f.orders.get(f.id).status,'결제취소');assert.equal((await(await f.status()).json()).paid,false);});
 for(const file of ['patch/app/admin/orders/OrderEntry.tsx','patch/app/api/payapp/request/route.ts']) {const result=ts.transpileModule(fs.readFileSync(path.join(base,file),'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX}});assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);}
 fs.writeFileSync(path.join(base,'test-results.json'),JSON.stringify({passed,productionOrdersCreated:0,actualPaymentRequests:0,actualSms:0},null,2));console.log('ALL '+passed+' checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
