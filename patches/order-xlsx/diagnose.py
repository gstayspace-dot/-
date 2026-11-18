"""Apply the native workbook export fix to the exact serving source."""
import copy,hashlib,http.cookiejar,json,os,pathlib,re,stat,subprocess,tarfile,tempfile,time,urllib.error,urllib.request,zipfile
PROJECT="primeval-falcon-491105-i9"; REGION="asia-northeast3"; SERVICE="yeongjinsangsa"
EXPECTED="yeongjinsangsa-00238-miy"
IMAGE="sha256:cd74773dc9f39711131e02ee9990fe7c3805da4ad7789ad9ecb7e1c2327a7f14"
SOURCE="gs://primeval-falcon-491105-i9_cloudbuild/source/1794885604.095432-4e30b47ce3e8453baf2bf03e4d4d50c6.tgz#1794885605007107"
DOMAINS=["https://yeongjinsangsa-865821327055.asia-northeast3.run.app","https://xn--oi2bm5bw2c73c.com"]
PATCH=pathlib.Path("patches/order-xlsx")
MANIFEST=json.loads((PATCH/"manifest.json").read_text())
TAG="order-xlsx-"+os.environ["GITHUB_RUN_ID"][-8:]
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
def health(base):
 result={}
 for path in ["/", "/cart", "/product/484bed71-baa3-49bf-b697-eff2e7c3c339", "/api/commerce/config", "/api/live/current"]:
  with urllib.request.urlopen(base+path,timeout=40) as r:
   assert r.status==200
   body=r.read()
   if path=="/api/commerce/config":result["commerce"]=json.loads(body)
 return result
before=service()
assert routing(before)=={EXPECTED:100},"Production changed; inspect first"
revision=read("run","revisions","describe",EXPECTED,"--region",REGION)
assert IMAGE in revision["spec"]["containers"][0]["image"]
assert runtime(before)==runtime({"spec":{"template":{"spec":revision["spec"]}}})
baseline=health(DOMAINS[0])
with tempfile.TemporaryDirectory(prefix="living-order-xlsx-") as td:
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
 hashes={p.relative_to(source).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob("*") if p.is_file()}
 for path,expected_hash in MANIFEST.items():
  assert hashes.get(path)==expected_hash,"Source changed for "+path
  target=source/path;target.parent.mkdir(parents=True,exist_ok=True)
  target.write_bytes((PATCH/path).read_bytes())
 after={p.relative_to(source).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob("*") if p.is_file()}
 assert {p for p in set(hashes)|set(after) if hashes.get(p)!=after.get(p)}==set(MANIFEST)
 assert service()["metadata"]["generation"]==before["metadata"]["generation"],"Concurrent deployment"
 print("Verified exact serving source; scoped changes: "+",".join(sorted(MANIFEST)),flush=True)

 stage="TypeScript diagnostic"
 subprocess.run(["npm","ci","--ignore-scripts","--no-audit","--no-fund"],cwd=source,stdout=subprocess.DEVNULL,check=True,timeout=300)
 result=subprocess.run(["npx","tsc","--noEmit"],cwd=source,capture_output=True,text=True,timeout=240)
 print(result.stdout+result.stderr,flush=True)
 assert result.returncode==0,"TypeScript validation failed"
