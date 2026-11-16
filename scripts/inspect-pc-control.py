import json,pathlib,subprocess,zipfile,re,tarfile
PROJECT="primeval-falcon-491105-i9"
REGION="asia-northeast3"
SERVICE="yeongjinsangsa"
def cloud(*args):
 p=subprocess.run(["gcloud",*args,"--project",PROJECT,"--quiet"],capture_output=True,text=True,timeout=120)
 if p.returncode:raise RuntimeError("Read failed: "+" ".join(args[:3]))
 return p.stdout
def read(*args):return json.loads(cloud(*args,"--format=json"))
s=read("run","services","describe",SERVICE,"--region",REGION)
rows=[x for x in s["status"]["traffic"] if x.get("percent")]
assert len(rows)==1 and rows[0]["percent"]==100
name=rows[0]["revisionName"]
r=read("run","revisions","describe",name,"--region",REGION)
ann=r["metadata"].get("annotations",{})
uri=ann.get("run.googleapis.com/build-source-location")
if not uri:
 image=r["spec"]["containers"][0]["image"]
 builds=read("builds","list","--region",REGION,"--limit","30")
 matches=[b for b in builds if any(x.get("digest") and x["digest"] in image for x in b.get("results",{}).get("images",[]))]
 assert matches,"No source for current image"
 src=matches[0]["source"]["storageSource"]
 uri=json.dumps({"source":"gs://"+src["bucket"]+"/"+src["object"]+"#"+str(src["generation"])})
sources=json.loads(uri)
assert len(sources)==1
cloud("storage","cp",next(iter(sources.values())),"/tmp/living-current.zip")
print("METADATA "+json.dumps({"revision":name,"source_uri":next(iter(sources.values())),"image":r["spec"]["containers"][0]["image"]}),flush=True)
archive="/tmp/living-current.zip"
if zipfile.is_zipfile(archive):
 z=zipfile.ZipFile(archive)
 names=z.namelist()
 read_file=lambda n:z.read(n)
else:
 z=tarfile.open(archive,"r:*")
 names=z.getnames()
 read_file=lambda n:z.extractfile(n).read()
for name in ["app/admin/live-control/page.tsx","app/api/live/current/route.ts","lib/live-overlay-server.ts","lib/use-live-current.ts","middleware.ts","lib/admin-auth.ts","app/api/admin/login/route.ts","lib/marketing/server.ts","lib/server/auth.ts"]:
 matches=[n for n in names if n.lstrip("./")==name]
 if not matches:continue
 content=read_file(matches[0]).decode("utf-8")
 content=re.sub(r'((?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY)\s*=\s*)[\'"][^\'"]+[\'"]',r'\1"[REDACTED]"',content,flags=re.I)
 print("SOURCE_FILE_BEGIN "+name,flush=True)
 print(content,flush=True)
 print("SOURCE_FILE_END "+name,flush=True)
