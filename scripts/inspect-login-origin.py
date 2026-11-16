import json, pathlib, subprocess, tempfile, zipfile, stat
def cloud(*args):
    return subprocess.check_output(["gcloud",*args,"--project","primeval-falcon-491105-i9","--quiet"],text=True)
service=json.loads(cloud("run","services","describe","yeongjinsangsa","--region","asia-northeast3","--format=json"))
traffic=[x for x in service["status"]["traffic"] if x.get("percent")]
assert len(traffic)==1 and traffic[0]["percent"]==100
revision=traffic[0]["revisionName"]
print("CURRENT_REVISION",revision,flush=True)
r=json.loads(cloud("run","revisions","describe",revision,"--region","asia-northeast3","--format=json"))
uri=service["metadata"]["annotations"]["run.googleapis.com/build-source-location"]
if uri.startswith("{"):
    sources=json.loads(uri)
    assert len(sources)==1
    uri=next(iter(sources.values()))
build=json.loads(cloud("builds","describe",service["metadata"]["annotations"]["run.googleapis.com/build-id"],"--region","asia-northeast3","--format=json"))
image=r["spec"]["containers"][0]["image"]
print("BUILD_IMAGES",json.dumps(build["results"]["images"]),flush=True)
print("RUN_IMAGE",image,flush=True)
assert uri.startswith("gs://run-sources-primeval-falcon-491105-i9-asia-northeast3/services/yeongjinsangsa/")
with tempfile.TemporaryDirectory() as t:
    archive=pathlib.Path(t)/"source.zip"
    cloud("storage","cp",uri,str(archive))
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            if not name.endswith((".ts",".tsx")):continue
            code=z.read(name).decode("utf-8")
            if "CROSS_ORIGIN" in code:
                lines=code.splitlines()
                indexes=set()
                for i,line in enumerate(lines):
                    if "CROSS_ORIGIN" in line:indexes.update(range(max(0,i-35),min(len(lines),i+10)))
                print("FILE",name,flush=True)
                for i in sorted(indexes):print(str(i+1)+": "+lines[i],flush=True)
