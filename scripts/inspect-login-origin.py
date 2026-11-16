import json,subprocess,pathlib,tempfile,re
def cloud(*args):return subprocess.check_output(["gcloud",*args,"--project","primeval-falcon-491105-i9","--quiet"],text=True)
s=json.loads(cloud("run","services","describe","yeongjinsangsa","--region","asia-northeast3","--format=json"))
rev=next(x["revisionName"] for x in s["status"]["traffic"] if x.get("percent")==100)
r=json.loads(cloud("run","revisions","describe",rev,"--region","asia-northeast3","--format=json"))
image=r["spec"]["containers"][0]["image"]
for region in ["asia-northeast3","global"]:
    builds=json.loads(cloud("builds","list","--region",region,"--limit","60","--format=json"))
    matches=[b for b in builds if any(x.get("digest","NO_DIGEST") in image for x in b.get("results",{}).get("images",[]))]
    print("MATCHING_BUILDS",region,json.dumps([{"id":b["id"],"source":b.get("source"),"createTime":b["createTime"]} for b in matches]),flush=True)
cloud("auth","configure-docker","asia-northeast3-docker.pkg.dev")
subprocess.run(["docker","pull",image],check=True,stdout=subprocess.DEVNULL)
cid=subprocess.check_output(["docker","create",image],text=True).strip()
with tempfile.TemporaryDirectory() as t:
    subprocess.run(["docker","cp",cid+":/app/.next/server",t+"/server"],check=True)
    for p in pathlib.Path(t).rglob("*.js"):
        code=p.read_text(errors="replace")
        if "CROSS_ORIGIN" not in code:continue
        print("FILE",str(p.relative_to(t)),flush=True)
        for m in re.finditer("CROSS_ORIGIN",code):
            print("CONTEXT",code[max(0,m.start()-1400):m.end()+400],flush=True)
        print("ENV_NAMES",sorted(set(re.findall(r"process\.env\.([A-Z_0-9]+)",code))),flush=True)
subprocess.run(["docker","rm",cid],check=True,stdout=subprocess.DEVNULL)
