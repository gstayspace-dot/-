import copy
import hashlib
import html
import json
import os
import pathlib
import re
import stat
import subprocess
import tempfile
import time
import urllib.request
import zipfile

PROJECT = "primeval-falcon-491105-i9"
REGION = "asia-northeast3"
SERVICE = "yeongjinsangsa"
DOMAIN = "https://xn--oi2bm5bw2c73c.com"
EXPECTED_REVISION = "yeongjinsangsa-00161-hxf"
CSS_PATH = "app/live/overlay/overlay.css"
TAG = "motion-" + os.environ["GITHUB_RUN_ID"][-8:]
stage = "initial check"
promoted = False
new_revision = None

def gcloud(*args):
    r = subprocess.run(["gcloud", *args, "--project", PROJECT, "--quiet"], capture_output=True, text=True, timeout=1500)
    if r.returncode:
        raise RuntimeError("Cloud command failed at " + stage + " (exit " + str(r.returncode) + ")")
    return r.stdout

def read(*args):
    return json.loads(gcloud(*args, "--format=json"))

def service():
    return read("run", "services", "describe", SERVICE, "--region", REGION)

def routing(s):
    return {r["revisionName"]: r.get("percent", 0) for r in s["status"].get("traffic", []) if r.get("percent", 0)}

def config(s):
    value = copy.deepcopy(s["spec"]["template"]["spec"])
    for c in value.get("containers", []):
        c.pop("image", None)
    return value

def get(url):
    req = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "User-Agent": "LivingBannerDeployCheck/1.0"})
    with urllib.request.urlopen(req, timeout=30) as response:
        assert response.status == 200
        return response.read().decode("utf-8")

def title(base):
    return re.search(r"<title>(.*?)</title>", get(base + "/"), re.S).group(1)

def check_overlay(base):
    page = get(base + "/live/overlay")
    hrefs = re.findall(r'<link\b[^>]*href="([^"]+)"[^>]*>', page)
    css_hrefs = [html.unescape(x) for x in hrefs if ".css" in x]
    assert css_hrefs, "Overlay styles missing"
    text = "\n".join(get(base + x) for x in css_hrefs if x.startswith("/"))
    for marker in ["living-loop-sheen", "living-loop-price", "living-loop-discount", "infinite", "라이브 특가", "정상가"]:
        assert marker in text, "Motion styles missing"
    state = json.loads(get(base + "/api/live/current"))
    assert set(["visible", "product", "revision", "error"]) <= set(state)
    assert state["error"] is None, "Current state unhealthy"
    get(base + "/admin/login")
    return len(text)

try:
    before = service()
    assert before["status"]["latestReadyRevisionName"] == EXPECTED_REVISION, "Production changed; inspect new version first"
    assert routing(before) == {EXPECTED_REVISION: 100}, "Unexpected traffic; stop"
    old_title = title(DOMAIN)
    baseline = json.loads(get(DOMAIN + "/api/live/current"))
    assert baseline["error"] is None
    revision = read("run", "revisions", "describe", EXPECTED_REVISION, "--region", REGION)
    sources = json.loads(revision["metadata"]["annotations"]["run.googleapis.com/build-source-location"])
    assert len(sources) == 1
    uri = next(iter(sources.values()))
    assert uri.startswith("gs://run-sources-" + PROJECT + "-" + REGION + "/services/" + SERVICE + "/")
    patch = pathlib.Path("docs/obs-overlay-loop.css").read_text(encoding="utf-8")
    assert "living-loop-sheen" in patch
    with tempfile.TemporaryDirectory(prefix="living-current-") as temp:
        root = pathlib.Path(temp)
        archive = root / "source.zip"
        stage = "source recovery"
        gcloud("storage", "cp", uri, str(archive))
        source = root / "source"
        source.mkdir()
        with zipfile.ZipFile(archive) as z:
            for item in z.infolist():
                path = pathlib.PurePosixPath(item.filename)
                assert not path.is_absolute() and ".." not in path.parts
                assert not stat.S_ISLNK(item.external_attr >> 16)
            z.extractall(source)
        target = source / CSS_PATH
        original = target.read_text(encoding="utf-8")
        assert ".live-prices" in original and "living-loop-" not in original
        assert (source / "app/live/overlay/page.tsx").is_file()
        assert (source / "Dockerfile").is_file()
        digest_before = {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob("*") if p.is_file()}
        target.write_text(original + "\n" + patch + "\n", encoding="utf-8")
        digest_after = {str(p.relative_to(source)): hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob("*") if p.is_file()}
        assert [p for p in digest_before if digest_before[p] != digest_after[p]] == [CSS_PATH]
        assert set(digest_before) == set(digest_after)
        assert service()["metadata"]["generation"] == before["metadata"]["generation"], "Concurrent production change"
        print("Verified exact running source; only " + CSS_PATH + " changed", flush=True)
        stage = "isolated source build and deployment"
        gcloud("run", "deploy", SERVICE, "--source", str(source), "--region", REGION, "--no-traffic", "--tag", TAG)
        candidate = service()
        new_revision = candidate["status"]["latestReadyRevisionName"]
        assert new_revision != EXPECTED_REVISION
        assert routing(candidate) == {EXPECTED_REVISION: 100}, "Traffic changed during candidate deployment"
        assert config(candidate) == config(before), "Runtime configuration differs; candidate not promoted"
        url = next(r["url"] for r in candidate["status"]["traffic"] if r.get("tag") == TAG)
        stage = "candidate verification"
        check_overlay(url)
        assert title(url) == old_title, "Homepage title changed"
        latest = service()
        assert latest["metadata"]["generation"] == candidate["metadata"]["generation"], "Concurrent deployment change"
        stage = "traffic promotion"
        gcloud("run", "services", "update-traffic", SERVICE, "--region", REGION, "--to-revisions", new_revision + "=100")
        promoted = True
        stage = "live domain verification"
        for attempt in range(6):
            try:
                check_overlay(DOMAIN)
                assert title(DOMAIN) == old_title
                break
            except Exception:
                if attempt == 5:
                    raise
                time.sleep(5)
        final = service()
        assert routing(final) == {new_revision: 100}
        assert config(final) == config(before)
        report = {"success": True, "old_revision": EXPECTED_REVISION, "new_revision": new_revision, "domain": DOMAIN, "changed_files": [CSS_PATH], "runtime_configuration_preserved": True, "traffic_percent": 100, "css_sha256": digest_after[CSS_PATH]}
        pathlib.Path("inspection").mkdir(exist_ok=True)
        pathlib.Path("inspection/motion-deployment.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report, indent=2), flush=True)
        stage = "temporary tag cleanup"
        gcloud("run", "services", "update-traffic", SERVICE, "--region", REGION, "--remove-tags", TAG)
except Exception as error:
    if promoted and new_revision:
        now = service()
        if routing(now) == {new_revision: 100}:
            stage = "rollback after verification failure"
            gcloud("run", "services", "update-traffic", SERVICE, "--region", REGION, "--to-revisions", EXPECTED_REVISION + "=100")
            print("Restored previous production traffic", flush=True)
    print("Stopped safely at stage: " + stage, flush=True)
    raise
