"""Read the exact serving source. No database, orders, SMS, PayApp or deployment writes."""
import hashlib,json,pathlib,subprocess,tarfile,zipfile
P='primeval-falcon-491105-i9';R='asia-northeast3';S='yeongjinsangsa'
def cloud(*args):
    p=subprocess.run(['gcloud',*args,'--project',P,'--quiet'],capture_output=True,text=True,timeout=180)
    if p.returncode:raise RuntimeError('Cloud read failed')
    return p.stdout
def read(*args):return json.loads(cloud(*args,'--format=json'))
s=read('run','services','describe',S,'--region',R)
t=[x for x in s['status']['traffic'] if x.get('percent')]
assert len(t)==1 and t[0]['percent']==100
rev=t[0]['revisionName'];d=read('run','revisions','describe',rev,'--region',R)
image=d['spec']['containers'][0]['image']
builds=read('builds','list','--region',R,'--limit','60')
b=next(b for b in builds if any(x.get('digest') and x['digest'] in image for x in b.get('results',{}).get('images',[])))
src=b['source']['storageSource'];uri='gs://'+src['bucket']+'/'+src['object']+'#'+str(src['generation'])
cloud('storage','cp',uri,'/tmp/shop-card-current')
archive='/tmp/shop-card-current'
allow={'package.json','package-lock.json','tsconfig.json','next.config.js','next.config.mjs',
 'app/admin/orders/OrderEntry.tsx','app/admin/orders/OrderEditor.tsx','app/admin/orders/LegacyOrdersPage.tsx',
 'app/api/admin/orders/legacy.ts','app/api/admin/orders/route.ts','app/api/admin/orders/edit/route.ts','app/api/admin/orders/resend/route.ts',
 'app/api/payapp/request/route.ts','app/api/payapp/feedback/route.ts','app/api/payapp/status/route.ts',
 'app/payment/payapp/PayappResult.tsx','lib/payapp.ts','lib/order-notification.ts','lib/order-resend-message.ts',
 'lib/cash-receipt.ts','lib/shipping-server.ts','lib/shipping-quote.ts','lib/admin-auth.ts','lib/consultation-order.ts'}
out=pathlib.Path('admin-card-source');out.mkdir()
if zipfile.is_zipfile(archive):
    z=zipfile.ZipFile(archive);rows=[(i.filename,not i.is_dir()) for i in z.infolist()];extract=z.read
else:
    z=tarfile.open(archive,'r:*');rows=[(i.name,i.isfile()) for i in z.getmembers()];extract=lambda n:z.extractfile(n).read()
selected={}
for n,regular in rows:
    if not regular:continue
    p=n[2:] if n.startswith('./') else n
    if p not in allow:continue
    assert '..' not in pathlib.PurePosixPath(p).parts
    raw=extract(n);dest=out/p;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
    selected[p]=hashlib.sha256(raw).hexdigest()
report={'revision':rev,'image':image,'source':uri,'build_id':b['id'],'generation':s['metadata']['generation'],
        'selected_sha256':selected,'runtime_payapp_enabled':next((x.get('value')=='true' for x in d['spec']['containers'][0].get('env',[]) if x['name']=='PAYAPP_ENABLED'),False)}
(out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({'revision':rev,'files':len(selected),'runtime_payapp_enabled':report['runtime_payapp_enabled']}))
