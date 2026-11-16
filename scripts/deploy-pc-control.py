"""Apply the scoped broadcast-origin fix to the exact serving source."""
import copy,hashlib,http.cookiejar,json,os,pathlib,stat,subprocess,tarfile,tempfile,time,urllib.error,urllib.request,zipfile
PROJECT="primeval-falcon-491105-i9"; REGION="asia-northeast3"; SERVICE="yeongjinsangsa"
EXPECTED="yeongjinsangsa-00215-buf"
IMAGE="sha256:3c9d919fdf88a34a55ce8a0cf99b804d1b7a4bff113dc9e6ca36a8e7dfdca383"
SOURCE="gs://primeval-falcon-491105-i9_cloudbuild/source/1794740980.424021-9273d56692b346ccbc1196d683568bf0.tgz#1794740983298217"
DOMAINS=["https://yeongjinsangsa-865821327055.asia-northeast3.run.app","https://xn--oi2bm5bw2c73c.com"]
TARGET="lib/live-overlay-server.ts"
TAG="pc-control-"+os.environ["GITHUB_RUN_ID"][-8:]
stage="inspection"; promoted=False; candidate_name=None
def cloud(*args):
 p=subprocess.run(["gcloud",*args,"--project",PROJECT,"--quiet"],capture_output=True,text=True,timeout=1500)
 if p.returncode:raise RuntimeError("Cloud command failed at "+stage+" (exit "+str(p.returncode)+")")
 return p.stdout
def read(*args):return json.loads(cloud(*args,"--format=json"))
def service():return read("run","services","describe",SERVICE,"--region",REGION)
def routing(s):return {x["revisionName"]:x["percent"] for x in s["status"]["traffic"] if x.get("percent")}
def runtime(s):
 v=copy.deepcopy(s["spec"]["template"]["spec"])
 for c in v["containers"]:
  c.pop("image",None);c.pop("name",None)
  if "env" in c:c["env"]=sorted(c["env"],key=lambda x:x["name"])
 return v
def call(base,path,origin=None,payload=None,opener=None,site="same-origin"):
 headers={"Cache-Control":"no-store"}
 if origin:headers["Origin"]=origin
 headers["Sec-Fetch-Site"]=site
 if payload is not None:headers["Content-Type"]="application/json"
 req=urllib.request.Request(base+path,data=json.dumps(payload).encode() if payload is not None else None,headers=headers)
 try:r=(opener.open(req,timeout=30) if opener else urllib.request.urlopen(req,timeout=30))
 except urllib.error.HTTPError as e:r=e
 return r.status,json.loads(r.read()) if "/api/" in path else r.read().decode()
def checks(base,username,password):
 assert call(base,"/api/live/current",DOMAINS[0],{})[0]==401,"Anonymous mutation allowed"
 results=[]
 for origin in DOMAINS:
  jar=http.cookiejar.CookieJar()
  opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
  status,body=call(base,"/api/admin/login",origin,{"username":username,"password":password},opener)
  assert status==200 and body.get("success"),"Existing login failed"
  assert call(base,"/api/live/products?q=nonexistent-pc-control-check",opener=opener)[0]==200,"Admin read failed"
  # Invalid payload must reach validation (400) without any state mutation.
  status,_=call(base,"/api/live/current",origin,{},opener)
  assert status==400,"Owned origin rejected before input validation: "+origin+" status "+str(status)
  for bad_origin,site in [("https://untrusted.invalid","same-origin"),(origin,"cross-site"),(None,"same-origin")]:
   assert call(base,"/api/live/current",bad_origin,{},opener,site)[0]==403,"Origin protection regressed"
  results.append({"origin":origin,"valid_origin_invalid_payload":400,"foreign_origin":403,"cross_site":403,"missing_origin":403})
  assert call(base,"/api/admin/logout",origin,{},opener)[0]==200
 for path in ["/","/live/overlay"]:
  assert call(base,path)[0]==200
 status,body=call(base,"/api/live/current")
 assert status==200 and body["error"] is None
 return results
before=service()
assert routing(before)=={EXPECTED:100},"Production changed; inspect first"
revision=read("run","revisions","describe",EXPECTED,"--region",REGION)
assert IMAGE in revision["spec"]["containers"][0]["image"]
# Preserve the exact serving runtime; never deploy the repository's old app.
assert runtime(before)==runtime({"spec":{"template":{"spec":revision["spec"]}}})
env={x["name"]:x.get("value") for x in revision["spec"]["containers"][0].get("env",[])}
username=env.get("ADMIN_USERNAME");password=env.get("ADMIN_PASSWORD")
assert username and password,"Existing runtime login verification unavailable"
baseline=call(DOMAINS[0],"/api/live/current")[1]
with tempfile.TemporaryDirectory(prefix="living-pc-control-") as td:
 root=pathlib.Path(td); archive=root/"source.archive";source=root/"source";source.mkdir()
 stage="source recovery";cloud("storage","cp",SOURCE,str(archive))
 if zipfile.is_zipfile(archive):
  with zipfile.ZipFile(archive) as z:
   for item in z.infolist():
    p=pathlib.PurePosixPath(item.filename)
    assert not p.is_absolute() and ".." not in p.parts and not stat.S_ISLNK(item.external_attr>>16)
   z.extractall(source)
 else:
  with tarfile.open(archive,"r:*") as z:z.extractall(source,filter="data")
 target=source/TARGET
 original=target.read_text(encoding="utf-8")
 old_import="import { sameOrigin, readBody } from './marketing/server'"
 old_guard="  if (!sameOrigin(request)) return reply({ error: '허용되지 않은 요청입니다.' }, 403)"
 assert original.count(old_import)==1 and original.count(old_guard)==1
 hashes={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob("*") if p.is_file()}
 new_import="import { readBody } from './marketing/server'\nimport { sameOrigin as requireAdminOrigin } from './server/auth'"
 new_guard="""  try {
    // Broadcast writes use the same owned origins as administrator login.
    // Keep an explicit Origin mandatory for this browser-only control.
    if (!request.headers.get('origin')) throw new Error('Origin required')
    requireAdminOrigin(request)
  } catch { return reply({ error: '허용되지 않은 요청입니다.' }, 403) }"""
 target.write_text(original.replace(old_import,new_import).replace(old_guard,new_guard),encoding="utf-8")
 after={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob("*") if p.is_file()}
 assert [p for p in hashes if hashes[p]!=after[p]]==[TARGET] and hashes.keys()==after.keys()
 assert service()["metadata"]["generation"]==before["metadata"]["generation"],"Concurrent deployment"
 print("Verified exact serving source; only "+TARGET+" changes",flush=True)
 stage="build candidate"
 cloud("run","deploy",SERVICE,"--source",str(source),"--region",REGION,"--no-traffic","--tag",TAG)
 candidate=service();candidate_name=candidate["status"]["latestReadyRevisionName"]
 assert candidate_name!=EXPECTED and routing(candidate)=={EXPECTED:100}
 assert runtime(candidate)==runtime(before),"Unrelated runtime setting changed"
 candidate_url=next(x["url"] for x in candidate["status"]["traffic"] if x.get("tag")==TAG)
 stage="candidate validation"
 result=checks(candidate_url,username,password)
 assert service()["metadata"]["generation"]==candidate["metadata"]["generation"],"Concurrent deployment"
 try:
  stage="promote verified fix"
  cloud("run","services","update-traffic",SERVICE,"--region",REGION,"--to-revisions",candidate_name+"=100")
  promoted=True
  stage="live verification"
  for attempt in range(6):
   try:
    for domain in DOMAINS:checks(domain,username,password)
    break
   except Exception:
    if attempt==5:raise
    time.sleep(5)
  final=service()
  assert routing(final)=={candidate_name:100} and runtime(final)==runtime(before)
  state=call(DOMAINS[0],"/api/live/current")[1]
  report={"success":True,"old_revision":EXPECTED,"new_revision":candidate_name,"changed_files":[TARGET],"runtime_preserved":True,"verification_sent_no_broadcast_mutations":True,"checks":result}
  print("DEPLOYMENT_RESULT "+json.dumps(report,ensure_ascii=False),flush=True)
 except Exception:
  if promoted and routing(service())=={candidate_name:100}:
   cloud("run","services","update-traffic",SERVICE,"--region",REGION,"--to-revisions",EXPECTED+"=100")
   print("Restored previous traffic",flush=True)
  raise
 finally:
  cloud("run","services","update-traffic",SERVICE,"--region",REGION,"--remove-tags",TAG)
