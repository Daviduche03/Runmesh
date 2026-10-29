"""End-to-end smoke test for a Runmesh instance (SQLite + DB-backed queue).

    uv run python scripts/smoke_vps.py http://localhost:8787 <jwt-secret> [path/to/runmesh.db]

Proves the scheduler sweep: a task created via /api/v1/tasks/schedule must sit
in `queued` until its due time and only then be dispatched. Cloudflare's cron
stopped doing this (workerd Pyodide NoGilError), which is why this exists.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8791"
SECRET = sys.argv[2] if len(sys.argv) > 2 else "your-long-random-secret"
DB = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("DB_PATH", "runmesh.db")
TARGET = "https://jsonplaceholder.typicode.com/posts"
USER_ID = "06cc37a3-f33c-4610-9f52-d0f701be7144"

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
from utils.auth import encode_token  # noqa: E402

# Every real login path (GitHub OAuth, /auth/exchange) requires a `users` row;
# seed the one GitHub's find_or_create_user would have made.
import sqlite3  # noqa: E402

conn = sqlite3.connect(DB)
conn.execute("PRAGMA foreign_keys=ON")
now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
conn.execute(
    "INSERT OR IGNORE INTO users (id, name, email, password, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    (USER_ID, "Smoke Tester", "test@test.com", "github_oauth:no_password", now, now),
)
conn.commit()
conn.close()

TOKEN = encode_token(
    {"id": USER_ID, "email": "test@test.com"},
    SECRET,
    3600,
)

results = []


def check(label, ok, detail=""):
    results.append((label, ok))
    print(("PASS  " if ok else "FAIL  ") + label + (("  -> " + str(detail)) if detail else ""), flush=True)


def call(method, path, body=None, auth=True, timeout=20):
    req = urllib.request.Request(BASE + path, method=method)
    if auth:
        req.add_header("Authorization", "Bearer " + TOKEN)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data, timeout=timeout) as resp:
            raw = resp.read().decode() or "{}"
            return resp.status, json.loads(raw) if raw.strip().startswith("{") or raw.strip().startswith("[") else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode() or "{}"
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, {}


def find_by_id(node, target):
    if isinstance(node, dict):
        if node.get("id") == target or node.get("task_id") == target:
            return node
        for value in node.values():
            found = find_by_id(value, target)
            if found:
                return found
    elif isinstance(node, list):
        for item in node:
            found = find_by_id(item, target)
            if found:
                return found
    return None


def task_status(task_id):
    _, payload = call("GET", "/api/v1/tasks?limit=200")
    return (find_by_id(payload, task_id) or {}).get("status")


# --- health (unauthenticated) -------------------------------------------------
status, payload = call("GET", "/health", auth=False)
check("health endpoint returns 200", status == 200, f"{status} {payload}")

# --- agent lifecycle ----------------------------------------------------------
status, payload = call("GET", "/api/v1/agents")
check("GET /api/v1/agents with JWT", status == 200, status)
before = payload if isinstance(payload, list) else (payload.get("data") or payload.get("agents") or [])
before = before if isinstance(before, list) else []

status, payload = call("POST", "/api/v1/agents", {"name": "smoke-vps-agent"})
agent = (payload.get("data") or {}) if isinstance(payload, dict) else {}
agent_id = agent.get("id")
check("create agent", status in (200, 201) and bool(agent_id), f"{status} {agent_id}")

if agent_id:
    status, payload = call("GET", "/api/v1/agents")
    listed = payload if isinstance(payload, list) else (payload.get("data") or payload.get("agents") or [])
    ids = [a.get("id") for a in listed if isinstance(a, dict)]
    check("agent appears in list", agent_id in ids, f"before={len(before)} after={len(ids)}")

    status, _ = call("DELETE", f"/api/v1/agents/{agent_id}")
    check("DELETE archives agent", status == 200, status)

    status, payload = call("GET", "/api/v1/agents")
    listed = payload if isinstance(payload, list) else (payload.get("data") or payload.get("agents") or [])
    ids = [a.get("id") for a in listed if isinstance(a, dict)]
    check("archived agent hidden from list", agent_id not in ids, f"{len(ids)} agents")

    status, _ = call("DELETE", f"/api/v1/agents/{agent_id}")
    check("DELETE is idempotent", status == 200, status)

    status, _ = call("DELETE", "/api/v1/agents/does-not-exist")
    check("DELETE unknown agent is 404", status == 404, status)

# --- queue execution (immediate) ---------------------------------------------
status, payload = call("POST", "/api/v1/tasks", {"url": TARGET, "payload": {"smoke": "queue"}})
task = (payload.get("data") or {}) if isinstance(payload, dict) else {}
queue_task_id = task.get("id") or task.get("task_id")
check("enqueue immediate task", status in (200, 201) and bool(queue_task_id), f"{status} {queue_task_id}")

# --- scheduled task: only the sweep may dispatch it --------------------------
# /api/v1/tasks/schedule creates status=queued WITHOUT a queue message, so the
# task must not move before its due time. That is exactly what Cloudflare's
# broken cron stopped doing.
due_at = time.time() + 12
due_in = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(due_at))
status, payload = call(
    "POST",
    "/api/v1/tasks/schedule",
    {"url": TARGET, "payload": {"smoke": "scheduled"}, "scheduled_at": due_in},
)
sched = (payload.get("data") or {}) if isinstance(payload, dict) else {}
sched_task_id = sched.get("task_id") or sched.get("id")
check("schedule task due in 12s", status in (200, 201) and bool(sched_task_id), f"{status} {sched_task_id}")

# Read it while it is still well before its due time.
time.sleep(2)
observed_at = time.time()
early = (task_status(sched_task_id) or "").lower() if sched_task_id else None
if observed_at < due_at - 3:
    check(
        "scheduled task still queued before due time (not dispatched at creation)",
        early in ("queued", ""),
        early,
    )
else:
    print("SKIP  early check (ran past the due time)", flush=True)

# The immediate task should run on its own.
queue_final = None
deadline = time.time() + 30
while time.time() < deadline:
    queue_final = (task_status(queue_task_id) or "").lower() if queue_task_id else None
    if queue_final in ("completed", "failed"):
        break
    time.sleep(1)
check("queue task executed", queue_final == "completed", queue_final)

final = None
deadline = time.time() + 60
while time.time() < deadline:
    final = (task_status(sched_task_id) or "").lower() if sched_task_id else None
    if final in ("completed", "failed"):
        break
    time.sleep(2)

check(
    "SCHEDULED task dispatched by the sweep after due time",
    final == "completed",
    final,
)

failed = [label for label, ok in results if not ok]
print("\n%d/%d checks passed" % (len(results) - len(failed), len(results)), flush=True)
if failed:
    print("FAILED: " + ", ".join(failed), flush=True)
sys.exit(1 if failed else 0)
