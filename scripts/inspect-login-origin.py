"""Correct administrator login origins without changing the running application image."""
import copy,json,subprocess,time,urllib.request,urllib.error,http.cookiejar,os
PROJECT="primeval-falcon-491105-i9"
REGION="asia-northeast3"
SERVICE="yeongjinsangsa"
BASE="https://yeongjinsangsa-865821327055.asia-northeast3.run.app"
CANONICAL="https://xn--oi2bm5bw2c73c.com"
EXPECTED="yeongjinsangsa-00207-yaf"
TAG="login-"+os.environ["GITHUB_RUN_ID"][-8:]
def cloud(*args):
    p=subprocess.run(["gcloud",*args,"--project",PROJECT,"--quiet"],capture_output=True,text=True,timeout=600)
    if p.returncode:raise RuntimeError("Cloud operation failed: "+args[0]+" "+args[1]+" (exit "+str(p.returncode)+")")
    return p.stdout
def read(*args):return json.loads(cloud(*args,"--format=json"))
def service():return read("run","services","describe",SERVICE,"--region",REGION)
def routing(s):return {x["revisionName"]:x["percent"] for x in s["status"]["traffic"] if x.get("percent")}
def runtime(s):
    d=copy.deepcopy(s["spec"]["template"]["spec"])
    for c in d["containers"]:
        c["env"]=sorted([x for x in c.get("env",[]) if x["name"]!="ADMIN_ALLOWED_ORIGINS"],key=lambda x:x["name"])
    return d
def call(url,origin=None,body=None,site="same-origin",opener=None):
    headers={"Cache-Control":"no-store"}
    if origin:headers.update({"Origin":origin,"Sec-Fetch-Site":site})
    if body is not None:headers["Content-Type"]="application/json"
    req=urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    try:r=(opener.open(req,timeout=30) if opener else urllib.request.urlopen(req,timeout=30))
    except urllib.error.HTTPError as e:r=e
    return r.status,r.headers,r.read()
def verify(base,origins,username,password):
    for origin in origins:
        status,_,body=call(base+"/api/admin/login",origin,{"username":"","password":""})
        assert status==401 and json.loads(body).get("code")=="UNAUTHORIZED","Allowed origin still rejected"
    for origin,site in [("https://untrusted.invalid","same-origin"),(origins[0],"cross-site")]:
        status,_,body=call(base+"/api/admin/login",origin,{"username":"","password":""},site)
        assert status==403 and json.loads(body).get("code")=="CROSS_ORIGIN","Cross-site protection changed"
    status,_,_=call(base+"/api/admin/me")
    assert status==401,"Anonymous session accepted"
    if username and password:
        jar=http.cookiejar.CookieJar()
        opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        status,headers,body=call(base+"/api/admin/login",origins[0],{"username":username,"password":password},opener=opener)
        assert status==200 and json.loads(body).get("success"),"Existing admin login failed"
        assert any(x.name=="admin_token" and x.secure and "HttpOnly" in x._rest for x in jar),"Session cookie missing protection"
        status,_,body=call(base+"/api/admin/me",opener=opener)
        assert status==200 and json.loads(body).get("role"),"Session not persisted"
        status,_,_=call(base+"/admin/products",opener=opener)
        assert status==200,"Admin navigation failed"
        status,_,_=call(base+"/api/admin/logout",origins[0],{},opener=opener)
        assert status==200,"Logout failed"
        status,_,_=call(base+"/api/admin/me",opener=opener)
        assert status==401,"Logout did not clear session"
    for path in ["/","/admin/login"]:
        assert call(base+path)[0]==200,"Public page unhealthy"
before=service()
assert routing(before)=={EXPECTED:100},"Production changed; re-inspection required"
container=before["spec"]["template"]["spec"]["containers"][0]
env={x["name"]:x for x in container.get("env",[])}
assert "valueFrom" not in env.get("ADMIN_ALLOWED_ORIGINS",{}),"Allowlist is secret-backed"
origins=json.loads(before["metadata"]["annotations"]["run.googleapis.com/urls"])
origins=list(dict.fromkeys([BASE,CANONICAL]+origins))
assert all(x.startswith("https://") and "|" not in x and "," not in x for x in origins)
existing=[x.strip() for x in env.get("ADMIN_ALLOWED_ORIGINS",{}).get("value","").split(",") if x.strip()]
allowed=list(dict.fromkeys(existing+origins))
username=env.get("ADMIN_USERNAME",{}).get("value")
password=env.get("ADMIN_PASSWORD",{}).get("value")
assert username and password,"Login verification requires existing runtime credentials"
assert service()["metadata"]["generation"]==before["metadata"]["generation"],"Concurrent production change"
print("Applying only ADMIN_ALLOWED_ORIGINS; exact application image retained",flush=True)
cloud("run","services","update",SERVICE,"--region",REGION,"--update-env-vars","^|^ADMIN_ALLOWED_ORIGINS="+",".join(allowed),"--no-traffic","--tag",TAG)
candidate=service()
new_revision=candidate["status"]["latestReadyRevisionName"]
assert new_revision!=EXPECTED
assert routing(candidate)=={EXPECTED:100},"Traffic changed unexpectedly"
assert runtime(candidate)==runtime(before),"Unrelated runtime setting changed"
def runtime_annotations(value):
    return {k:v for k,v in value["spec"]["template"]["metadata"].get("annotations",{}).items() if k not in ["run.googleapis.com/client-name","run.googleapis.com/client-version","run.googleapis.com/operation-id"]}
assert runtime_annotations(candidate)==runtime_annotations(before),"Runtime annotations changed"
candidate_url=next(x["url"] for x in candidate["status"]["traffic"] if x.get("tag")==TAG)
print("Checking candidate origin policy, existing login, cookies, navigation and logout",flush=True)
verify(candidate_url,origins,username,password)
assert service()["metadata"]["generation"]==candidate["metadata"]["generation"],"Concurrent deployment change"
promoted=False
try:
    cloud("run","services","update-traffic",SERVICE,"--region",REGION,"--to-revisions",new_revision+"=100")
    promoted=True
    for attempt in range(6):
        try:
            verify(BASE,origins,username,password)
            break
        except Exception:
            if attempt==5:raise
            time.sleep(5)
    assert routing(service())=={new_revision:100}
    assert runtime(service())==runtime(before)
    print(json.dumps({"success":True,"old_revision":EXPECTED,"new_revision":new_revision,"allowed_origins":allowed,"image_unchanged":True,"traffic_percent":100,"checks":["all owned origins","foreign-origin rejection","cross-site rejection","existing admin login","secure httponly cookies","authenticated admin page","logout"],"live_url":BASE},indent=2),flush=True)
except Exception:
    if promoted and routing(service())=={new_revision:100}:
        cloud("run","services","update-traffic",SERVICE,"--region",REGION,"--to-revisions",EXPECTED+"=100")
        print("Restored previous production traffic",flush=True)
    raise
finally:
    cloud("run","services","update-traffic",SERVICE,"--region",REGION,"--remove-tags",",".join([TAG]+[x["tag"] for x in before["status"]["traffic"] if x.get("tag")=="login-22056052"]))
