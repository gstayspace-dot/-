"""Apply the native workbook export fix to the exact serving source."""
import shutil,copy,hashlib,http.cookiejar,json,os,pathlib,re,stat,subprocess,tarfile,tempfile,time,urllib.error,urllib.request,zipfile
PROJECT="primeval-falcon-491105-i9"; REGION="asia-northeast3"; SERVICE="yeongjinsangsa"
EXPECTED="yeongjinsangsa-00254-xik"
IMAGE="sha256:b6562b40cf275a45df1845bb4f7b1c06509a04d019b0c6025a23be464f054c32"
SOURCE="gs://primeval-falcon-491105-i9_cloudbuild/source/1795075817.041894-fe86bf219bde410192a93d39ed27fb13.tgz#1795075818007397"
DOMAINS=["https://yeongjinsangsa-865821327055.asia-northeast3.run.app","https://xn--oi2bm5bw2c73c.com"]
PATCH=pathlib.Path("patches/bank-notice")
MANIFEST=json.loads((PATCH/"manifest.json").read_text())
TAG="bank-notice-"+os.environ["GITHUB_RUN_ID"][-8:]
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
IMAGE=revision["spec"]["containers"][0]["image"].split("@",1)[1]
assert IMAGE.startswith("sha256:")
builds=read("builds","list","--region",REGION,"--limit","40")
matches=[b for b in builds if any(x.get("digest")==IMAGE for x in b.get("results",{}).get("images",[]))]
assert matches,"Serving build provenance missing"
provenance=read("builds","describe",matches[0]["id"],"--region",REGION)
ss=provenance.get("sourceProvenance",{}).get("resolvedStorageSource") or provenance["source"]["storageSource"]
SOURCE="gs://"+ss["bucket"]+"/"+ss["object"]+("#"+str(ss["generation"]) if ss.get("generation") else "")
assert runtime(before)==runtime({"spec":{"template":{"spec":revision["spec"]}}})
baseline=health(DOMAINS[0])
with tempfile.TemporaryDirectory(prefix="living-bank-notice-") as td:
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
 stage="validate source types"
 check_source=root/"typecheck"
 shutil.copytree(source,check_source,ignore=shutil.ignore_patterns("node_modules",".next",".git"))
 subprocess.run(["npm","ci","--ignore-scripts","--no-audit","--no-fund"],cwd=check_source,stdout=subprocess.DEVNULL,check=True,timeout=300)
 checked=subprocess.run(["npx","tsc","--noEmit","--incremental","false"],cwd=check_source,capture_output=True,text=True,timeout=240)
 if checked.returncode: print(checked.stdout+checked.stderr,flush=True); raise RuntimeError("TypeScript validation failed")
 print("Full source TypeScript check passed",flush=True)
 stage="build candidate"
 # Reproduce the currently serving image's public Docker build arguments.
 # They are intentionally browser-visible; never read server secrets into build args.
 builds=read("builds","list","--region",REGION,"--limit","40")
 matches=[b for b in builds if any(x.get("digest")==IMAGE for x in b.get("results",{}).get("images",[]))]
 assert matches,"Original build provenance unavailable"
 original_build=read("builds","describe",matches[0]["id"],"--region",REGION)
 substitutions={**original_build.get("substitutions",{}),"PROJECT_ID":PROJECT}
 def resolve(value):
  value=re.sub(r"\$\{([A-Za-z0-9_]+)\}",lambda m:substitutions.get(m[1],m[0]),value)
  value=re.sub(r"\$([A-Za-z0-9_]+)",lambda m:substitutions.get(m[1],m[0]),value)
  assert "$" not in value,"Unresolved original public build argument"
  return value
 dockerfile=(source/"Dockerfile").read_text(encoding="utf-8")
 declared=dict((key,default or "") for key,default in re.findall(r"^ARG (NEXT_PUBLIC_[A-Z0-9_]+)(?:=([^\n]*))?$",dockerfile,re.M))
 public_args=dict(declared)
 for step in original_build["steps"]:
  args=step.get("args",[])
  step_env={x.split("=",1)[0]:resolve(x.split("=",1)[1]) for x in step.get("env",[]) if "=" in x and x.startswith("NEXT_PUBLIC_")}
  for i,arg in enumerate(args):
   value=args[i+1] if arg=="--build-arg" and i+1<len(args) else arg.split("=",1)[1] if arg.startswith("--build-arg=") else None
   if value:
    key,sep,content=value.partition("=")
    if key in declared:
     public_args[key]=resolve(content) if sep else step_env.get(key,"")
 assert public_args.get("NEXT_PUBLIC_SUPABASE_URL") and public_args.get("NEXT_PUBLIC_SUPABASE_ANON_KEY"),"Original public Supabase build settings unavailable"
 assert all(key.startswith("NEXT_PUBLIC_") for key in public_args)
 image_tag="asia-northeast3-docker.pkg.dev/"+PROJECT+"/cloud-run-source-deploy/"+SERVICE+":bank-notice-"+os.environ["GITHUB_RUN_ID"]
 args=["build","-t",image_tag]
 for key in public_args:args+=["--build-arg",key]
 args+=["."]
 build_config={"steps":[{"name":"gcr.io/cloud-builders/docker","args":args,"env":[key+"="+value for key,value in public_args.items()]}],"images":[image_tag],"options":{"logging":"CLOUD_LOGGING_ONLY"}}
 if original_build.get("serviceAccount"):build_config["serviceAccount"]=original_build["serviceAccount"]
 config_file=root/"cloudbuild.json";config_file.write_text(json.dumps(build_config),encoding="utf-8")
 print("Preserving original public Docker argument names: "+",".join(sorted(public_args)),flush=True)
 stage="build exact source with preserved public settings"
 cloud("builds","submit",str(source),"--config",str(config_file),"--region",REGION)
 assert service()["metadata"]["generation"]==before["metadata"]["generation"],"Concurrent deployment during build"
 stage="deploy staged candidate"
 cloud("run","deploy",SERVICE,"--image",image_tag,"--region",REGION,"--no-traffic","--tag",TAG)
 candidate=service();candidate_name=candidate["status"]["latestReadyRevisionName"]
 assert candidate_name!=EXPECTED and routing(candidate)=={EXPECTED:100}
 assert runtime(candidate)==runtime(before),"Unrelated runtime setting changed"
 candidate_url=next(x["url"] for x in candidate["status"]["traffic"] if x.get("tag")==TAG)
 stage="candidate validation"
 assert health(candidate_url)==baseline,"Public configuration changed"

 with urllib.request.urlopen(candidate_url+"/live/overlay",timeout=40) as response:markup=response.read().decode()
 links=re.findall(r'<link[^>]+href="([^"]+\.css[^"]*)"',markup)
 assert links,"Overlay stylesheet missing"
 css=""
 for link in links:
  if link.startswith("/"):
   with urllib.request.urlopen(candidate_url+link,timeout=40) as response:css+=response.read().decode()
 assert all(marker in css for marker in ["living-broadcast-cycle","840s","49.89%","living-motion-photo","living-motion-saving"]),"OBS motion/cycle styles missing"
 for path in ["/api/admin/order-products?q=test","/api/admin/order-shipping"]:
  try:
   request=urllib.request.Request(candidate_url+path,data=b'{"items":[]}' if path.endswith("order-shipping") else None,headers={"Content-Type":"application/json"})
   urllib.request.urlopen(request,timeout=30)
   raise AssertionError("Administrator session required")
  except urllib.error.HTTPError as error:assert error.code==401
 print("Candidate OBS cycle styles and administrator authorization verified",flush=True)
 report={"success":True,"old_revision":EXPECTED,"new_revision":candidate_name,"candidate_url":candidate_url,"tag":TAG,"generation":candidate["metadata"]["generation"],"changed_files":sorted(MANIFEST),"runtime_preserved":True,"public_build_arguments_preserved":True,"traffic_promoted":False}
 pathlib.Path("bank-notice-stage.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
 print("STAGING_RESULT "+json.dumps(report,ensure_ascii=False),flush=True)
