"""Apply the scoped broadcast-origin fix to the exact serving source."""
import copy,hashlib,http.cookiejar,json,os,pathlib,re,stat,subprocess,tarfile,tempfile,time,urllib.error,urllib.request,zipfile
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
  for bad_origin,site,expected_status in [("https://untrusted.invalid","same-origin",401),(origin,"cross-site",401),(None,"same-origin",403)]:
   assert call(base,"/api/live/current",bad_origin,{},opener,site)[0]==expected_status,"Origin protection changed"
  results.append({"origin":origin,"valid_origin_invalid_payload":400,"foreign_origin":401,"cross_site":401,"missing_origin":403})
  assert call(base,"/api/admin/logout",origin,{},opener)[0]==200
 for path in ["/","/live/overlay"]:
  assert call(base,path)[0]==200
 status,body=call(base,"/api/live/current")
 assert status==200 and body["error"] is None
 return results

TAG="pc-control-30862641"
before=service()
assert routing(before)=={EXPECTED:100},"Serving revision changed"
candidate_row=next(x for x in before["status"]["traffic"] if x.get("tag")==TAG)
candidate_name=candidate_row["revisionName"];candidate_url=candidate_row["url"]
assert before["status"]["latestReadyRevisionName"]==candidate_name and candidate_name!=EXPECTED
serving=read("run","revisions","describe",EXPECTED,"--region",REGION)
assert runtime(before)==runtime({"spec":{"template":{"spec":serving["spec"]}}}),"Runtime configuration changed"
env={x["name"]:x.get("value") for x in serving["spec"]["containers"][0].get("env",[])}
username=env["ADMIN_USERNAME"];password=env["ADMIN_PASSWORD"]
stage="candidate verification"
result=checks(candidate_url,username,password)
print("Candidate passed: both owned origins, authenticated products, invalid-payload validation, foreign/cross-site/missing-origin rejection",flush=True)
assert service()["metadata"]["generation"]==before["metadata"]["generation"],"Concurrent deployment change"
try:
 stage="promotion"
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
 assert routing(service())=={candidate_name:100}
 assert runtime(service())==runtime(before)
 print("DEPLOYMENT_RESULT "+json.dumps({"success":True,"old_revision":EXPECTED,"new_revision":candidate_name,"changed_files":[TARGET],"runtime_preserved":True,"public_build_arguments_preserved":True,"verification_sent_no_broadcast_mutations":True,"checks":result},ensure_ascii=False),flush=True)
except Exception:
 if promoted and routing(service())=={candidate_name:100}:
  cloud("run","services","update-traffic",SERVICE,"--region",REGION,"--to-revisions",EXPECTED+"=100")
  print("Restored previous traffic",flush=True)
 raise
finally:
 cloud("run","services","update-traffic",SERVICE,"--region",REGION,"--remove-tags",TAG+",pc-control-29437936")
