#!/usr/bin/env python3
"""Seed a record-and-replay demo into the local workspace so the UI can show it.

Run with cwd=runmesh-main and PYTHONPATH=src (the migrations must be applied):

    PYTHONPATH=src uv run --no-sync python scripts/seed_replay_demo.py [workspace_id]

Creates (or reuses) a "Replay Demo" agent, records an origin run with a tool
trace, then opens a replay run carrying a `replay.diff` verdict with one
divergence. Prints the dashboard URL. Also an end-to-end smoke of the
resolve / run / ingest / replay endpoints.
"""

import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "http://localhost:8787"
FRONTEND = "http://localhost:5173"


def jwt_secret() -> str:
    for line in Path(".dev.vars").read_text().splitlines():
        if line.startswith("JWT_SECRET="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("JWT_SECRET not found in .dev.vars")


def rows(sql: str) -> list:
    proc = subprocess.run(
        ["uv", "run", "pywrangler", "d1", "execute", "runmesh-db", "--local", "--json", "--command", sql],
        capture_output=True, text=True, check=False,
    )
    out = proc.stdout + proc.stderr
    dec = json.JSONDecoder()
    idx = 0
    while True:
        i = out.find("[", idx)
        if i < 0:
            raise SystemExit(f"d1 output not parseable: {out[-400:]}")
        try:
            value, _ = dec.raw_decode(out, i)
            break
        except ValueError:
            idx = i + 1
    merged: list = []
    for chunk in value:
        merged.extend(chunk.get("results") or [])
    return merged


def call(method: str, path: str, token: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"{method} {path} -> {exc.code}: {exc.read().decode()[:400]}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"{method} {path} -> {exc}. Is the backend running on {API}?")


def main() -> None:
    sys.path.insert(0, "src")
    from utils.auth import encode_token

    workspace = sys.argv[1] if len(sys.argv) > 1 else rows(
        "SELECT id FROM workspaces ORDER BY created_at LIMIT 1"
    )[0]["id"]
    owner = rows(f"SELECT owner_user_id FROM workspaces WHERE id='{workspace}'")[0]["owner_user_id"]
    user = rows(f"SELECT id, email, name FROM users WHERE id='{owner}'")[0]
    token = encode_token(
        {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "api_key_workspace_id": workspace,
        },
        jwt_secret(),
        ttl_seconds=3600,
    )

    agent = call("PUT", "/api/v1/agents:resolve", token, {
        "external_key": "replay-demo",
        "fingerprint": "fp_replay_demo_v1",
        "name": "Replay Demo",
        "framework": "vercel-ai-sdk",
        "model": "claude-sonnet-4-5",
        "system_prompt": "You triage GitHub issues and comment when useful.",
        "tools": [
            {"name": "github_issues_get", "kind": "local"},
            {"name": "github_issues_comment", "kind": "local"},
        ],
    })["data"]
    agent_id = agent["id"]

    origin = call("POST", "/api/v1/runs", token, {
        "agent_id": agent_id,
        "input": "Summarize issue 42 and leave a comment.",
    })["data"]
    rid = origin["id"]
    call("POST", "/api/v1/ingest", token, {"events": [
        {"run_id": rid, "kind": "model.request", "name": "claude-sonnet-4-5", "args": {
            "prompt": "Summarize issue 42 and leave a comment.",
            "tools": ["github_issues_get", "github_issues_comment"]}},
        {"run_id": rid, "kind": "model.response", "name": "claude-sonnet-4-5", "result": {
            "toolCalls": [{"toolName": "github_issues_get", "args": {"repo": "acme/api", "number": 42}}],
            "finishReason": "tool-calls"}},
        {"run_id": rid, "kind": "tool.call", "name": "github_issues_get",
         "args": {"repo": "acme/api", "number": 42}},
        {"run_id": rid, "kind": "tool.result", "name": "github_issues_get",
         "result": {"title": "Login fails on Safari", "state": "open", "labels": ["bug"]}, "duration_ms": 128},
        {"run_id": rid, "kind": "model.response", "name": "claude-sonnet-4-5", "result": {
            "toolCalls": [{"toolName": "github_issues_comment",
                           "args": {"repo": "acme/api", "number": 42, "body": "Looks like a cookie issue."}}],
            "finishReason": "tool-calls"}},
        {"run_id": rid, "kind": "tool.call", "name": "github_issues_comment",
         "args": {"repo": "acme/api", "number": 42, "body": "Looks like a cookie issue."}},
        {"run_id": rid, "kind": "tool.result", "name": "github_issues_comment",
         "result": {"id": 991, "body": "Looks like a cookie issue."}, "duration_ms": 210},
        {"run_id": rid, "kind": "model.response", "name": "claude-sonnet-4-5", "result": {
            "text": "Summarized issue 42 and commented.", "finishReason": "stop"}},
    ]})
    call("POST", f"/api/v1/runs/{rid}/finish", token, {"status": "completed", "usage": {"tokens": 812}})

    replay = call("POST", f"/api/v1/runs/{rid}/replay", token)["data"]
    replay_id = replay["id"]
    call("POST", "/api/v1/ingest", token, {"events": [
        {"run_id": replay_id, "kind": "tool.call", "name": "github_issues_get",
         "args": {"repo": "acme/api", "number": 42}},
        {"run_id": replay_id, "kind": "tool.result", "name": "github_issues_get",
         "result": {"title": "Login fails on Safari", "state": "open", "labels": ["bug"]}, "duration_ms": 131},
        {"run_id": replay_id, "kind": "tool.call", "name": "github_issues_comment",
         "args": {"repo": "acme/api", "number": 42, "body": "Possible cookie regression."}},
        {"run_id": replay_id, "kind": "tool.result", "name": "github_issues_comment",
         "result": {"id": 992, "body": "Possible cookie regression."}, "duration_ms": 205},
        {"run_id": replay_id, "kind": "log", "name": "replay.diff", "result": {
            "identical": False,
            "comparedSteps": 2,
            "divergences": [
                {
                    "index": 1,
                    "original": {"kind": "tool.call", "name": "github_issues_comment",
                                 "args": {"repo": "acme/api", "number": 42,
                                          "body": "Looks like a cookie issue."}},
                    "replayed": {"kind": "tool.call", "name": "github_issues_comment",
                                 "args": {"repo": "acme/api", "number": 42,
                                          "body": "Possible cookie regression."}},
                }
            ],
        }},
    ]})
    call("POST", f"/api/v1/runs/{replay_id}/finish", token, {"status": "failed"})

    print(f"workspace : {workspace}")
    print(f"agent     : {agent_id}")
    print(f"origin run: {rid}")
    print(f"replay run: {replay_id}")
    print()
    print(f"Open: {FRONTEND}/agents/{agent_id}")
    print(f"(expand the two runs — the replay row shows the diff panel; use Playback in the audit view)")


if __name__ == "__main__":
    main()
