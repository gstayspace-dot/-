import json
import pathlib
import subprocess

PROJECT = "primeval-falcon-491105-i9"
REGION = "asia-northeast3"
SERVICE = "yeongjinsangsa"

def read_gcloud(*args):
    result = subprocess.run(["gcloud", *args, "--project", PROJECT, "--format=json", "--quiet"], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Google Cloud read failed: " + " ".join(args[:3]))
    return json.loads(result.stdout)

service = read_gcloud("run", "services", "describe", SERVICE, "--region", REGION)
revision_name = service["status"]["latestReadyRevisionName"]
revision = read_gcloud("run", "revisions", "describe", revision_name, "--region", REGION)
annotations = revision.get("metadata", {}).get("annotations", {})
safe_keys = [
    "run.googleapis.com/build-name",
    "run.googleapis.com/source-location",
    "run.googleapis.com/build-source-location",
    "run.googleapis.com/build-image-uri",
    "client.knative.dev/user-image",
]
report = {
    "service": SERVICE,
    "revision": revision_name,
    "image": revision.get("spec", {}).get("containers", [{}])[0].get("image"),
    "source_annotations": {key: annotations[key] for key in safe_keys if key in annotations},
    "traffic": [{"revisionName": row.get("revisionName"), "percent": row.get("percent")} for row in service.get("status", {}).get("traffic", [])],
    "recent_builds": {},
}
for location in [REGION, "global"]:
    try:
        builds = read_gcloud("builds", "list", "--region", location, "--limit", "10")
        report["recent_builds"][location] = [
            {"id": row.get("id"), "createTime": row.get("createTime"), "source": row.get("source", {}).get("storageSource"), "images": row.get("results", {}).get("images", [])}
            for row in builds
        ]
    except RuntimeError:
        report["recent_builds"][location] = {"read_available": False}
pathlib.Path("inspection").mkdir(exist_ok=True)
pathlib.Path("inspection/current-source.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
