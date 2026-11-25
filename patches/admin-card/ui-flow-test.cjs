const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const ts=require('../../node_modules/typescript');
const source=fs.readFileSync(path.join(__dirname,'patch/app/admin/orders/OrderEntry.tsx'),'utf8');
const handler=source.slice(source.indexOf('  async function submit('),source.indexOf('\n  return <section'));
const js=ts.transpileModule(handler,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(options={}){
 const state={link:'',message:'',error:'',open:0,close:0,reset:0,created:0},calls=[];
 const ctx={URL,crypto:require('node:crypto').webcrypto,submitting:{current:false},cardRequestId:{current:''},shippingReady:true,selected:[{id:'product'}],quantities:{product:1},quote:{total:24000},name:'시험',phone:'01000000000',address:'시험 주소',customerRequest:'',skipSms:false,importSourceId:'',paymentMethod:options.method||'card',
 window:{open:()=>{state.open++;return options.blockPopup?null:{opener:{},location:{replace:url=>state.navigated=url},close:()=>{state.close++}}}},
 setBusy:()=>{},setError:v=>state.error=v,setMessage:v=>state.message=v,setPaymentLink:v=>state.link=v,onCreated:()=>state.created++,
 setPaymentMethod:v=>ctx.paymentMethod=v,fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body),openBeforeFetch:state.open});if(options.pause)await options.pause();if(options.networkFail)throw Error('unknown response');return{ok:!options.httpFail,json:async()=>({order:{id:'11111111-1111-4111-8111-111111111111'},sms:{sent:true},payment:ctx.paymentMethod==='card'?(options.paymentFailure?{pending:true,error:'결과 확인 필요'}:{payurl:options.badUrl?'https://evil.test':'https://payapp.kr/fixture'}):undefined,error:'이미 접수된 주문'})}}};
 for(const name of ['setQuantities','setChosen','setName','setPhone','setCustomerRequest','setImportSourceId','setAddress','setAddedMessage','setSearch','setSubmittedSearch','setProducts','setHasMore','setSkipSms','setOpen'])ctx[name]=()=>{};
 vm.createContext(ctx);vm.runInContext(js,ctx);
 return{state,calls,ctx,submit:()=>ctx.submit({preventDefault(){},currentTarget:{reset:()=>state.reset++}})};
}
let passed=0;async function test(name,run){await run();passed++;console.log('PASS '+name)}
(async()=>{
 await test('cash uses original payload and never opens payment window',async()=>{const f=fixture({method:'bank'});await f.submit();assert.equal(f.calls[0].body.paymentMethod,undefined);assert.equal(f.calls[0].body.cardRequestId,undefined);assert.equal(f.state.open,0);assert.equal(f.state.created,1);});
 await test('card opens window during gesture then navigates returned link',async()=>{const f=fixture();await f.submit();assert.equal(f.calls[0].openBeforeFetch,1);assert.equal(f.calls[0].body.paymentMethod,'card');assert.match(f.calls[0].body.cardRequestId,/^[0-9a-f-]{36}$/);assert.equal(f.state.navigated,'https://payapp.kr/fixture');assert.equal(f.state.close,0);assert.match(f.state.message,/결제대기/);assert.match(f.state.message,/카드 승인 통보 후/);});
 await test('blocked popup still exposes payment link',async()=>{const f=fixture({blockPopup:true});await f.submit();assert.equal(f.state.link,'https://payapp.kr/fixture');assert.equal(f.state.created,1);});
 await test('gateway failure preserves registered order and closes blank window',async()=>{const f=fixture({paymentFailure:true});await f.submit();assert.match(f.state.message,/다시 등록하지/);assert.equal(f.state.created,1);assert.equal(f.state.close,1);assert.equal(f.state.link,'');});
 await test('lost response retains same card request ID for safe duplicate rejection',async()=>{const f=fixture({networkFail:true});await f.submit();const id=f.calls[0].body.cardRequestId;await f.submit();assert.equal(f.calls[1].body.cardRequestId,id);assert.equal(f.state.created,0);assert.equal(f.state.close,2);});
 await test('rapid double submit does not create a second window or HTTP request',async()=>{let release;const f=fixture({pause:()=>new Promise(r=>release=r)});const first=f.submit();await f.submit();assert.equal(f.calls.length,1);assert.equal(f.state.open,1);release();await first;});
 await test('malicious returned link cannot open',async()=>{const f=fixture({badUrl:true});await f.submit();assert.equal(f.state.navigated,undefined);assert.equal(f.state.link,'');assert.match(f.state.error,/링크 검증/);assert.equal(f.state.close,1);});
 fs.writeFileSync(path.join(__dirname,'ui-test-results.json'),JSON.stringify({passed,actualBrowserPopupTested:false,productionWrites:0},null,2));console.log('ALL '+passed+' checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
