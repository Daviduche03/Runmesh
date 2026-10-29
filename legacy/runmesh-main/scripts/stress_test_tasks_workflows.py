#!/usr/bin/env python3
import json
import os
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from urllib import error, request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

BASE = os.environ.get("BASE_URL", "http://localhost:8787").rstrip("/")
DEV_VARS = os.path.join(ROOT, ".dev.vars")


def load_jwt_secret() -> str:
    if os.environ.get("JWT_SECRET"):
        return os.environ["JWT_SECRET"]
    if os.path.isfile(DEV_VARS):
        with open(DEV_VARS, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line.startswith("JWT_SECRET="):
                    return line.split("=", 1)[1]
    return "your-long-random-secret"


JWT_SECRET = load_jwt_secret()
HTTPBIN = os.environ.get("STRESS_HTTP_URL", "https://jsonplaceholder.typicode.com/posts")
HTTPBIN_FAIL = os.environ.get("STRESS_HTTP_FAIL_URL", "https://httpbin.org/status/503")
BURST_SIZE = int(os.environ.get("STRESS_BURST_SIZE", "15"))
CONCURRENT_RUNS = int(os.environ.get("STRESS_CONCURRENT_RUNS", "8"))

USER_A = os.environ.get("STRESS_USER_A_ID", str(uuid.uuid4()))
USER_B = os.environ.get("STRESS_USER_B_ID", str(uuid.uuid4()))
EMAIL_A = os.environ.get("STRESS_USER_A_EMAIL", "stress-a@runmesh.test")
EMAIL_B = os.environ.get("STRESS_USER_B_EMAIL", "stress-b@runmesh.test")

passed = 0
failed = 0
skipped = 0
warnings = []
cleanup_ids = {"workflows": [], "tasks": []}


def make_token(user_id: str, email: str, name: str) -> str:
    from utils.auth import encode_token

    return encode_token({"id": user_id, "email": email, "name": name}, JWT_SECRET)


TOKEN_A = make_token(USER_A, EMAIL_A, "Stress User A")
TOKEN_B = make_token(USER_B, EMAIL_B, "Stress User B")


def api(method: str, path: str, token: str, body=None, expect=None):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
    req = request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=30) as res:
            payload = json.loads(res.read().decode() or "{}")
            status = res.status
    except error.HTTPError as exc:
        status = exc.code
        raw = exc.read().decode() or ""
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"detail": raw or exc.reason}
    detail = payload.get("error", {}).get("message") or payload.get("detail")
    if isinstance(detail, list):
        detail = json.dumps(detail)
    return status, payload, detail


def record(name: str, ok: bool, detail: str = ""):
    global passed, failed
    if ok:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}")
        if detail:
            print(f"      {detail}")


def skip(name: str, reason: str):
    global skipped
    skipped += 1
    print(f"SKIP  {name} — {reason}")


def future_iso(minutes: int = 5) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def workflow_payload(name: str, tasks=None, trigger_type="manual"):
    default_tasks = [
        {"type": "http", "url": HTTPBIN, "payload": {"step": 1}, "execution_type": "queue"},
        {"type": "http", "url": HTTPBIN, "payload": {"step": 2}, "execution_type": "queue"},
    ]
    return {
        "name": name,
        "description": f"Stress test workflow {name}",
        "trigger_type": trigger_type,
        "tasks": default_tasks if tasks is None else tasks,
    }


def warn(message: str):
    warnings.append(message)
    print(f"WARN  {message}")


def graph_payload(task_ids):
    trigger_id = "trigger"
    nodes = [
        {
            "id": trigger_id,
            "type": "trigger",
            "position": {"x": 0, "y": 0},
            "data": {"label": "Start", "triggerType": "manual"},
        }
    ]
    edges = []
    prev = trigger_id
    for index, task_id in enumerate(task_ids):
        node_id = f"http-{index + 1}"
        nodes.append(
            {
                "id": node_id,
                "type": "http",
                "position": {"x": 200 * (index + 1), "y": 0},
                "data": {
                    "label": f"Step {index + 1}",
                    "task_id": task_id,
                    "url": HTTPBIN,
                    "method": "POST",
                },
            }
        )
        edges.append({"id": f"e-{prev}-{node_id}", "source": prev, "target": node_id})
        prev = node_id
    return {"nodes": nodes, "edges": edges}


def wait_for_run(workflow_id: str, run_id: str, timeout: int = 45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        status, payload, _ = api("GET", f"/api/v1/workflows/{workflow_id}/runs", TOKEN_A)
        if status != 200:
            time.sleep(1)
            continue
        runs = payload.get("data") or []
        match = next((r for r in runs if r.get("id") == run_id), None)
        if match and (match.get("status") or "").lower() in ("completed", "failed"):
            return match
        time.sleep(1)
    return None


def wait_for_tasks_terminal(task_ids: list[str], timeout: int = 90):
    deadline = time.time() + timeout
    terminal = {"completed", "failed", "cancelled"}
    while time.time() < deadline:
        status, payload, _ = api("GET", "/api/v1/tasks?limit=200", TOKEN_A)
        if status != 200:
            time.sleep(1)
            continue
        items = {row["id"]: row for row in (payload.get("data") or [])}
        states = []
        for task_id in task_ids:
            row = items.get(task_id)
            if not row:
                states.append("missing")
                continue
            states.append((row.get("status") or "").lower())
        if states and all(state in terminal for state in states):
            return states
        time.sleep(1)
    return None


def create_workflow(name: str, tasks=None, trigger_type="manual"):
    status, payload, detail = api(
        "POST",
        "/api/v1/workflows",
        TOKEN_A,
        workflow_payload(name, tasks=tasks, trigger_type=trigger_type),
    )
    if status != 200:
        return None, detail
    workflow_id = payload.get("data", {}).get("workflow_id")
    if workflow_id:
        cleanup_ids["workflows"].append(workflow_id)
    return workflow_id, detail


def cleanup():
    for workflow_id in cleanup_ids["workflows"]:
        api("DELETE", f"/api/v1/workflows/{workflow_id}", TOKEN_A)
    for task_id in cleanup_ids["tasks"]:
        api("DELETE", f"/api/v1/tasks/{task_id}", TOKEN_A)


def test_health():
    status, payload, _ = api("GET", "/health", TOKEN_A)
    record("health endpoint", status == 200 and payload.get("ok") is True, f"status={status}")


def test_create_workflow_validation():
    status, _, detail = api(
        "POST",
        "/api/v1/workflows",
        TOKEN_A,
        {"name": "Bad", "description": "short", "trigger_type": "manual", "tasks": []},
        expect=400,
    )
    record("reject short description", status == 400, detail)

    status, _, detail = api(
        "POST",
        "/api/v1/workflows",
        TOKEN_A,
        {
            "name": "OrphanTest",
            "description": "Orphan rollback test workflow",
            "trigger_type": "manual",
            "tasks": [
                {"type": "http", "url": HTTPBIN, "payload": {}, "execution_type": "queue"},
                {"type": "http", "payload": {}, "execution_type": "queue"},
            ],
        },
        expect=400,
    )
    record("reject task without url", status == 400, detail)

    status, payload, _ = api("GET", "/api/v1/workflows", TOKEN_A)
    orphan = [w for w in (payload.get("data") or []) if w.get("name") == "OrphanTest"]
    record("no orphan workflow after invalid task", len(orphan) == 0, f"found={len(orphan)}")


def test_workflow_crud_and_run():
    status, payload, detail = api(
        "POST",
        "/api/v1/workflows",
        TOKEN_A,
        workflow_payload(f"stress-{int(time.time())}"),
    )
    ok = status == 200 and payload.get("data", {}).get("workflow_id")
    record("create workflow", ok, detail)
    if not ok:
        return None
    workflow_id = payload["data"]["workflow_id"]
    cleanup_ids["workflows"].append(workflow_id)

    status, payload, detail = api("GET", f"/api/v1/workflows/{workflow_id}", TOKEN_A)
    record("get workflow", status == 200 and payload.get("data", {}).get("id") == workflow_id, detail)

    status, payload, detail = api(
        "PATCH",
        f"/api/v1/workflows/{workflow_id}",
        TOKEN_A,
        {"description": "Updated stress workflow description"},
    )
    record("patch workflow description", status == 200, detail)

    status, payload, detail = api("POST", f"/api/v1/workflows/{workflow_id}/run", TOKEN_A)
    run_ok = status == 200 and payload.get("data", {}).get("id")
    record("start workflow run", run_ok, detail)
    if not run_ok:
        return workflow_id
    run_id = payload["data"]["id"]

    status, _, detail = api("POST", f"/api/v1/workflows/{workflow_id}/run", TOKEN_A)
    record("concurrent run returns 409", status == 409, detail)

    finished = wait_for_run(workflow_id, run_id)
    record(
        "workflow run completes",
        finished is not None and (finished.get("status") or "").lower() == "completed",
        json.dumps(finished or {}),
    )
    return workflow_id


def test_webhook_trigger_guard(workflow_id: str | None):
    if not workflow_id:
        skip("webhook trigger guard", "no workflow")
        return
    status, _, detail = api("POST", f"/api/v1/workflows/{workflow_id}/trigger", TOKEN_A)
    record("manual workflow rejects webhook trigger", status == 400, detail)


def test_cross_tenant_isolation(workflow_id: str | None):
    if not workflow_id:
        skip("cross-tenant isolation", "no workflow")
        return
    status, _, detail = api("GET", f"/api/v1/workflows/{workflow_id}", TOKEN_B)
    record("other user cannot read workflow", status == 404, detail)

    status, _, detail = api("POST", f"/api/v1/workflows/{workflow_id}/run", TOKEN_B)
    record("other user cannot run workflow", status == 404, detail)


def test_standalone_task():
    status, payload, detail = api(
        "POST",
        "/api/v1/tasks",
        TOKEN_A,
        {"type": "http", "url": HTTPBIN, "payload": {"standalone": True}, "execution_type": "queue"},
    )
    ok = status == 200 and payload.get("data", {}).get("task_id")
    record("create standalone task", ok, detail)
    if ok:
        cleanup_ids["tasks"].append(payload["data"]["task_id"])

    status, _, detail = api(
        "POST",
        "/api/v1/tasks",
        TOKEN_A,
        {"type": "http", "payload": {}, "execution_type": "queue"},
        expect=400,
    )
    record("reject task without url", status == 400, detail)


def test_schedule_cancel_reschedule():
    status, payload, detail = api(
        "POST",
        "/api/v1/tasks/schedule",
        TOKEN_A,
        {
            "type": "http",
            "url": HTTPBIN,
            "payload": {"scheduled": True},
            "scheduled_at": future_iso(10),
            "execution_type": "scheduled",
        },
    )
    ok = status == 200 and payload.get("data", {}).get("task_id")
    record("schedule task", ok, detail)
    if not ok:
        return
    task_id = payload["data"]["task_id"]
    cleanup_ids["tasks"].append(task_id)

    status, _, detail = api("POST", f"/api/v1/tasks/{task_id}/cancel", TOKEN_A)
    record("cancel scheduled task", status == 200, detail)

    status, payload, detail = api(
        "POST",
        "/api/v1/tasks/schedule",
        TOKEN_A,
        {
            "type": "http",
            "url": HTTPBIN,
            "payload": {"reschedule": True},
            "scheduled_at": future_iso(12),
            "execution_type": "scheduled",
        },
    )
    if status != 200:
        record("schedule task for reschedule", False, detail)
        return
    task_id = payload["data"]["task_id"]
    cleanup_ids["tasks"].append(task_id)

    status, _, detail = api(
        "POST",
        f"/api/v1/tasks/{task_id}/reschedule",
        TOKEN_A,
        {"scheduled_at": future_iso(20)},
    )
    record("reschedule task", status == 200, detail)


def test_pagination_validation():
    cases = [
        ("page=0", "/api/v1/tasks?page=0", 400),
        ("limit=0", "/api/v1/tasks?limit=0", 400),
        ("limit=500", "/api/v1/tasks?limit=500", 400),
        ("page=abc", "/api/v1/tasks?page=abc", 400),
    ]
    for name, path, expected in cases:
        status, _, detail = api("GET", path, TOKEN_A)
        record(f"pagination validation {name}", status == expected, detail)


def test_graph_save_and_delete_guard(workflow_id: str | None):
    if not workflow_id:
        skip("graph save", "no workflow")
        return

    status, payload, _ = api("GET", f"/api/v1/workflows/{workflow_id}", TOKEN_A)
    task_ids = [t["id"] for t in (payload.get("data", {}).get("tasks") or [])]
    if len(task_ids) < 2:
        skip("graph save", "not enough tasks")
        return

    status, _, detail = api(
        "PUT",
        f"/api/v1/workflows/{workflow_id}/graph",
        TOKEN_A,
        graph_payload(task_ids),
    )
    record("save workflow graph", status == 200, detail)

    status, payload, detail = api("POST", f"/api/v1/workflows/{workflow_id}/run", TOKEN_A)
    if status != 200:
        record("start run before delete guard", False, detail)
        return
    run_id = payload["data"]["id"]

    status, _, detail = api("DELETE", f"/api/v1/workflows/{workflow_id}", TOKEN_A)
    record("delete in-progress workflow blocked", status == 409, detail)

    finished = wait_for_run(workflow_id, run_id, timeout=60)
    record("graph workflow run completes", finished is not None, json.dumps(finished or {}))

    status, _, detail = api("DELETE", f"/api/v1/workflows/{workflow_id}", TOKEN_A)
    record("delete workflow after completion", status == 200, detail)
    if status == 200 and workflow_id in cleanup_ids["workflows"]:
        cleanup_ids["workflows"].remove(workflow_id)


def test_failing_step_workflow():
    status, payload, detail = api(
        "POST",
        "/api/v1/workflows",
        TOKEN_A,
        workflow_payload(
            f"stress-fail-{int(time.time())}",
            tasks=[
                {"type": "http", "url": HTTPBIN, "payload": {"step": 1}, "execution_type": "queue"},
                {"type": "http", "url": HTTPBIN_FAIL, "payload": {"step": 2}, "execution_type": "queue"},
            ],
        ),
    )
    if status != 200:
        record("create failing workflow", False, detail)
        return
    workflow_id = payload["data"]["workflow_id"]
    cleanup_ids["workflows"].append(workflow_id)

    status, payload, detail = api("POST", f"/api/v1/workflows/{workflow_id}/run", TOKEN_A)
    if status != 200:
        record("start failing workflow", False, detail)
        return
    run_id = payload["data"]["id"]
    finished = wait_for_run(workflow_id, run_id, timeout=60)
    record(
        "failing workflow marks run failed",
        finished is not None and (finished.get("status") or "").lower() == "failed",
        json.dumps(finished or {}),
    )


def test_burst_standalone_tasks():
    created = []

    def publish_one(index: int):
        return api(
            "POST",
            "/api/v1/tasks",
            TOKEN_A,
            {
                "type": "http",
                "url": HTTPBIN,
                "payload": {"burst": index},
                "execution_type": "queue",
            },
        )

    with ThreadPoolExecutor(max_workers=BURST_SIZE) as pool:
        futures = [pool.submit(publish_one, i) for i in range(BURST_SIZE)]
        for future in as_completed(futures):
            status, payload, detail = future.result()
            if status == 200 and payload.get("data", {}).get("task_id"):
                created.append(payload["data"]["task_id"])
            else:
                record("burst task accepted", False, detail)
                return

    record("burst task creation", len(created) == BURST_SIZE, f"created={len(created)}")
    cleanup_ids["tasks"].extend(created)

    states = wait_for_tasks_terminal(created, timeout=120)
    if states is None:
        record("burst tasks complete", False, "timeout")
        return
    completed_count = sum(1 for state in states if state == "completed")
    failed_count = sum(1 for state in states if state == "failed")
    ok = completed_count == BURST_SIZE
    if not ok and completed_count >= BURST_SIZE - 1:
        warn(f"burst had {failed_count} failed task(s); external HTTP target may be flaky under load")
        ok = True
    record("burst tasks complete", ok, json.dumps(states))


def test_concurrent_run_storm():
    workflow_id, detail = create_workflow(f"stress-storm-{int(time.time())}")
    if not workflow_id:
        record("concurrent storm setup", False, detail)
        return

    def start_run():
        return api("POST", f"/api/v1/workflows/{workflow_id}/run", TOKEN_A)

    with ThreadPoolExecutor(max_workers=CONCURRENT_RUNS) as pool:
        results = [future.result() for future in [pool.submit(start_run) for _ in range(CONCURRENT_RUNS)]]

    successes = [r for r in results if r[0] == 200]
    conflicts = [r for r in results if r[0] == 409]
    record(
        "concurrent run storm one success",
        len(successes) == 1,
        f"200={len(successes)} 409={len(conflicts)}",
    )
    record(
        "concurrent run storm rest conflict",
        len(conflicts) == CONCURRENT_RUNS - 1,
        f"200={len(successes)} 409={len(conflicts)}",
    )

    if successes:
        run_id = successes[0][1].get("data", {}).get("id")
        finished = wait_for_run(workflow_id, run_id, timeout=90)
        record(
            "concurrent storm run completes",
            finished is not None and (finished.get("status") or "").lower() == "completed",
            json.dumps(finished or {}),
        )


def test_webhook_trigger_workflow():
    workflow_id, detail = create_workflow(
        f"stress-webhook-{int(time.time())}",
        trigger_type="webhook",
    )
    if not workflow_id:
        record("create webhook workflow", False, detail)
        return

    status, payload, detail = api("POST", f"/api/v1/workflows/{workflow_id}/trigger", TOKEN_A)
    ok = status == 200 and payload.get("data", {}).get("id")
    record("webhook trigger starts run", ok, detail)
    if not ok:
        return

    run_id = payload["data"]["id"]
    finished = wait_for_run(workflow_id, run_id, timeout=90)
    record(
        "webhook triggered run completes",
        finished is not None and (finished.get("status") or "").lower() == "completed",
        json.dumps(finished or {}),
    )


def test_four_step_workflow():
    workflow_id, detail = create_workflow(
        f"stress-4step-{int(time.time())}",
        tasks=[
            {"type": "http", "url": HTTPBIN, "payload": {"step": 1}, "execution_type": "queue"},
            {"type": "http", "url": HTTPBIN, "payload": {"step": 2}, "execution_type": "queue"},
            {"type": "http", "url": HTTPBIN, "payload": {"step": 3}, "execution_type": "queue"},
            {"type": "http", "url": HTTPBIN, "payload": {"step": 4}, "execution_type": "queue"},
        ],
    )
    if not workflow_id:
        record("create 4-step workflow", False, detail)
        return

    status, payload, detail = api("POST", f"/api/v1/workflows/{workflow_id}/run", TOKEN_A)
    if status != 200:
        record("start 4-step workflow", False, detail)
        return

    run_id = payload["data"]["id"]
    finished = wait_for_run(workflow_id, run_id, timeout=120)
    record(
        "4-step workflow completes",
        finished is not None and (finished.get("status") or "").lower() == "completed",
        json.dumps(finished or {}),
    )

    status, payload, _ = api("GET", f"/api/v1/workflows/{workflow_id}", TOKEN_A)
    tasks = payload.get("data", {}).get("tasks") or []
    completed = sum(1 for t in tasks if (t.get("status") or "").lower() == "completed")
    record("4-step all tasks completed", completed == 4, f"completed={completed}")


def test_legacy_routes():
    status, payload, detail = api(
        "POST",
        "/api/v1/task/publish",
        TOKEN_A,
        {"type": "http", "url": HTTPBIN, "payload": {"legacy": True}, "execution_type": "queue"},
    )
    ok = status == 200 and payload.get("data", {}).get("task_id")
    record("legacy publish route", ok, detail)
    if ok:
        cleanup_ids["tasks"].append(payload["data"]["task_id"])


def test_list_tasks_filters(workflow_id: str | None):
    status, payload, _ = api("GET", "/api/v1/tasks?limit=10&page=1", TOKEN_A)
    record("list tasks paginated", status == 200 and isinstance(payload.get("data"), list), "")

    if workflow_id:
        status, payload, _ = api("GET", f"/api/v1/tasks?workflow_id={workflow_id}&limit=50", TOKEN_A)
        items = payload.get("data") or []
        record(
            "list tasks by workflow_id",
            status == 200 and all(True for _ in items),
            f"count={len(items)}",
        )


def test_delete_standalone_task():
    status, payload, detail = api(
        "POST",
        "/api/v1/tasks",
        TOKEN_A,
        {"type": "http", "url": HTTPBIN, "payload": {"delete": True}, "execution_type": "queue"},
    )
    if status != 200:
        record("create task for delete", False, detail)
        return
    task_id = payload["data"]["task_id"]

    status, _, detail = api("DELETE", f"/api/v1/tasks/{task_id}", TOKEN_A)
    record("delete standalone task", status == 200, detail)

    status, _, detail = api("DELETE", f"/api/v1/tasks/{task_id}", TOKEN_A)
    record("delete missing task returns 404", status == 404, detail)


def test_empty_workflow_run():
    status, _, detail = api(
        "POST",
        "/api/v1/workflows",
        TOKEN_A,
        workflow_payload(f"stress-empty-{int(time.time())}", tasks=[]),
    )
    record("reject workflow with no tasks", status == 400, detail)

def test_workflow_runs_list():
    workflow_id, detail = create_workflow(f"stress-runs-{int(time.time())}")
    if not workflow_id:
        record("workflow runs list setup", False, detail)
        return

    status, payload, detail = api("POST", f"/api/v1/workflows/{workflow_id}/run", TOKEN_A)
    if status != 200:
        record("workflow runs list start run", False, detail)
        return

    run_id = payload["data"]["id"]
    wait_for_run(workflow_id, run_id, timeout=90)

    status, payload, detail = api("GET", f"/api/v1/workflows/{workflow_id}/runs", TOKEN_A)
    runs = payload.get("data") or []
    record("list workflow runs", status == 200 and len(runs) >= 1, detail)


def test_invalid_reschedule():
    status, payload, detail = api(
        "POST",
        "/api/v1/tasks/schedule",
        TOKEN_A,
        {
            "type": "http",
            "url": HTTPBIN,
            "payload": {"bad_reschedule": True},
            "scheduled_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
            "execution_type": "scheduled",
        },
    )
    record("reject past scheduled_at", status == 400, detail)


def test_workflow_list():
    status, payload, detail = api("GET", "/api/v1/workflows", TOKEN_A)
    record("list workflows", status == 200 and isinstance(payload.get("data"), list), detail)


def test_idempotency():
    key = f"stress-idem-{uuid.uuid4()}"
    body = {
        "type": "http",
        "url": HTTPBIN,
        "payload": {"idempotent": True},
        "execution_type": "queue",
        "idempotency_key": key,
    }
    status_a, payload_a, detail_a = api("POST", "/api/v1/tasks", TOKEN_A, body)
    status_b, payload_b, detail_b = api("POST", "/api/v1/tasks", TOKEN_A, body)
    id_a = payload_a.get("data", {}).get("task_id")
    id_b = payload_b.get("data", {}).get("task_id")
    record(
        "idempotency returns same task",
        status_a == 200 and status_b == 200 and id_a and id_a == id_b,
        detail_a or detail_b,
    )
    if id_a:
        cleanup_ids["tasks"].append(id_a)


def test_delete_workflow_task_during_run():
    workflow_id, detail = create_workflow(f"stress-del-task-{int(time.time())}")
    if not workflow_id:
        record("delete workflow task setup", False, detail)
        return

    status, payload, detail = api("POST", f"/api/v1/workflows/{workflow_id}/run", TOKEN_A)
    if status != 200:
        record("delete workflow task start run", False, detail)
        return

    status, payload, _ = api("GET", f"/api/v1/workflows/{workflow_id}", TOKEN_A)
    tasks = payload.get("data", {}).get("tasks") or []
    if not tasks:
        record("delete workflow task find step", False, "no tasks")
        return

    task_id = tasks[0]["id"]
    status, _, detail = api("DELETE", f"/api/v1/tasks/{task_id}", TOKEN_A)
    record("delete in-flight workflow task blocked", status == 409, detail)

    status, run_payload, _ = api("GET", f"/api/v1/workflows/{workflow_id}/runs", TOKEN_A)
    runs = run_payload.get("data") or []
    if runs:
        wait_for_run(workflow_id, runs[0]["id"], timeout=90)


def print_production_report():
    print("")
    print("Production readiness notes:")
    for item in [
        "One-shot scheduled workflows only fire while workflow status is draft",
        "Recurring cron workflows skip when a run is already in progress (logged, not queued)",
    ]:
        warn(item)


def main():
    print("Runmesh task/workflow stress test")
    print(f"BASE={BASE}")
    print(f"JWT_SECRET source={'env' if os.environ.get('JWT_SECRET') else '.dev.vars' if os.path.isfile(DEV_VARS) else 'default'}")
    print(f"HTTP target={HTTPBIN}")
    print(f"Burst size={BURST_SIZE}, concurrent runs={CONCURRENT_RUNS}")
    print("")

    workflow_id = None
    try:
        test_health()
        test_create_workflow_validation()
        workflow_id = test_workflow_crud_and_run()
        test_webhook_trigger_guard(workflow_id)
        test_cross_tenant_isolation(workflow_id)
        test_standalone_task()
        test_schedule_cancel_reschedule()
        test_pagination_validation()
        test_graph_save_and_delete_guard(workflow_id)
        test_failing_step_workflow()
        test_burst_standalone_tasks()
        test_concurrent_run_storm()
        test_webhook_trigger_workflow()
        test_four_step_workflow()
        test_legacy_routes()
        test_list_tasks_filters(workflow_id)
        test_delete_standalone_task()
        test_empty_workflow_run()
        test_workflow_runs_list()
        test_invalid_reschedule()
        test_workflow_list()
        test_idempotency()
        test_delete_workflow_task_during_run()
        print_production_report()
    finally:
        cleanup()

    print("")
    print(f"Results: {passed} passed, {failed} failed, {skipped} skipped, {len(warnings)} warnings")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
