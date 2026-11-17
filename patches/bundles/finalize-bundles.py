import json,pathlib,subprocess
P='primeval-falcon-491105-i9';R='asia-northeast3';S='yeongjinsangsa'
def cloud(*a):
 p=subprocess.run(['gcloud',*a,'--project',P,'--quiet'],capture_output=True,text=True,timeout=240)
 if p.returncode:raise RuntimeError('Cloud command failed')
 return p.stdout
s=json.loads(cloud('run','services','describe',S,'--region',R,'--format=json'))
routing={x['revisionName']:x['percent'] for x in s['status']['traffic'] if x.get('percent')}
assert routing=={'yeongjinsangsa-00232-kaf':100},'Production changed; inspect first'
removed=[]
if any(x.get('tag')=='bundles-03022037' for x in s['status']['traffic']):
 cloud('run','services','update-traffic',S,'--region',R,'--remove-tags','bundles-03022037')
 removed.append('bundles-03022037')
s=json.loads(cloud('run','services','describe',S,'--region',R,'--format=json'))
assert {x['revisionName']:x['percent'] for x in s['status']['traffic'] if x.get('percent')}==routing
report={'success':True,'traffic':routing,'removed_superseded_task_tags':removed}
pathlib.Path('bundles-finalization.json').write_text(json.dumps(report,indent=2))
print('FINALIZATION_RESULT '+json.dumps(report))
