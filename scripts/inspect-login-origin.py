import json,subprocess,urllib.request,urllib.error,copy
def cloud(*a):return subprocess.check_output(["gcloud",*a,"--project","primeval-falcon-491105-i9","--quiet","--format=json"],text=True)
s=json.loads(cloud("run","services","describe","yeongjinsangsa","--region","asia-northeast3"))
r=json.loads(cloud("run","revisions","describe","yeongjinsangsa-00207-yaf","--region","asia-northeast3"))
a=s["spec"]["template"]["spec"];b=r["spec"]
print("IMAGES",a["containers"][0]["image"],b["containers"][0]["image"],flush=True)
ea={x["name"]:x for x in a["containers"][0].get("env",[])};eb={x["name"]:x for x in b["containers"][0].get("env",[])}
print("CHANGED_ENV_NAMES",[k for k in set(ea)|set(eb) if ea.get(k)!=eb.get(k)],flush=True)
print("CURRENT_ALLOWED_ORIGINS",ea.get("ADMIN_ALLOWED_ORIGINS"),flush=True)
print("OTHER_SPEC_DIFFERENCES",[k for k in set(a)|set(b) if k!="containers" and a.get(k)!=b.get(k)],flush=True)
for x in s["status"]["traffic"]:
    if not x.get("tag","").startswith("login-"):continue
    req=urllib.request.Request(x["url"]+"/api/admin/login",data=b'{"username":"","password":""}',headers={"Content-Type":"application/json","Origin":"https://yeongjinsangsa-865821327055.asia-northeast3.run.app","Sec-Fetch-Site":"same-origin"})
    try:response=urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:response=e
    print("CANDIDATE_RESPONSE",x["revisionName"],response.status,response.read().decode()[:400],flush=True)
