import copy,json,pathlib,subprocess,time,urllib.request
P='primeval-falcon-491105-i9';R='asia-northeast3';S='yeongjinsangsa'
record=json.loads(pathlib.Path('patches/admin-motion/admin-motion-stage.json').read_text())
old=record['old_revision'];new=record['new_revision'];tag=record['tag']
def cloud(*a):
 p=subprocess.run(['gcloud',*a,'--project',P,'--quiet'],capture_output=True,text=True,timeout=240)
 if p.returncode:raise RuntimeError('Cloud command failed: '+a[0]+' '+a[1])
 return p.stdout
def read(*a):return json.loads(cloud(*a,'--format=json'))
def service():return read('run','services','describe',S,'--region',R)
def routing(s):return {x['revisionName']:x['percent'] for x in s['status']['traffic'] if x.get('percent')}
def runtime(v):
 v=copy.deepcopy(v)
 for c in v['containers']:
  c.pop('image',None);c.pop('name',None)
  if 'env' in c:c['env']=sorted(c['env'],key=lambda x:x['name'])
 return v
def health(base):
 for path in ['/','/cart','/product/484bed71-baa3-49bf-b697-eff2e7c3c339','/api/commerce/config','/api/live/current']:
  with urllib.request.urlopen(base+path,timeout=40) as r:
   assert r.status==200
   if path=='/api/commerce/config':assert json.load(r)=={'enabled':False,'checkoutEnabled':False,'tossEnabled':False}
before=service()
assert routing(before)=={old:100},'Traffic changed; inspect first'
assert str(before['metadata']['generation'])==str(record['generation']),'Concurrent service change; inspect first'
assert before['status']['latestReadyRevisionName']==new
original=read('run','revisions','describe',old,'--region',R)
candidate=read('run','revisions','describe',new,'--region',R)
assert runtime(original['spec'])==runtime(candidate['spec'])==runtime(before['spec']['template']['spec'])
health(record['candidate_url'])
promoted=False
try:
 cloud('run','services','update-traffic',S,'--region',R,'--to-revisions',new+'=100');promoted=True
 for attempt in range(6):
  try:
   for base in ['https://xn--oi2bm5bw2c73c.com','https://yeongjinsangsa-865821327055.asia-northeast3.run.app']:health(base)
   break
  except Exception:
   if attempt==5:raise
   time.sleep(5)
 final=service();assert routing(final)=={new:100}
 assert runtime(final['spec']['template']['spec'])==runtime(original['spec'])
 cloud('run','services','update-traffic',S,'--region',R,'--remove-tags',tag)
 report={**record,'traffic_promoted':True,'hidden_product_behavior_tests_passed':12,'obs_cycle_seconds':840,'obs_visible_seconds':420,'obs_hidden_seconds':420,'browser_verified_before_promotion':False,'live_health_verified':True}
 pathlib.Path('admin-motion-deployment.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 print('DEPLOYMENT_RESULT '+json.dumps(report,ensure_ascii=False),flush=True)
except Exception:
 if promoted and routing(service())=={new:100}:
  cloud('run','services','update-traffic',S,'--region',R,'--to-revisions',old+'=100')
  print('Restored previous production traffic',flush=True)
 raise
