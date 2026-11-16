import json,subprocess
def read(*args):return json.loads(subprocess.check_output(["gcloud",*args,"--project","primeval-falcon-491105-i9","--quiet","--format=json"],text=True))
s=read("run","services","describe","yeongjinsangsa","--region","asia-northeast3")
rev=next(x["revisionName"] for x in s["status"]["traffic"] if x.get("percent")==100)
r=read("run","revisions","describe",rev,"--region","asia-northeast3")
print(json.dumps({"revision":rev,"service_annotations":s["metadata"].get("annotations"),"revision_annotations":r["metadata"].get("annotations"),"labels":r["metadata"].get("labels"),"images":[x["image"] for x in r["spec"]["containers"]]},indent=2))
