#!/usr/bin/env python3
"""SQL/crypto helper for the support tier-3 E2E.

Run with cwd=runmesh-main and PYTHONPATH=src.
Modes:
  t0              -> python-format UTC timestamp taken before any write
  counts          -> residue counts for the demo workspace
  encrypt <token> -> encrypted credential for the local JWT secret
  jwt             -> short-lived workspace-bound JWT for the driver/APIs
  seed            -> (re)create the support connect user + connection
  cleanup <t0>    -> delete only support E2E residue
  sql <statement> -> run one statement, print rows as JSON
"""
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

WS = "ws_2c2d5a5148e64b5cb6898b7b8772dd31"
USER_ID = "06cc37a3-f33c-4610-9f52-d0f701be7144"
CU = "cu_support"
CONN = "conn_e2e_support"
TOKEN = "support_key_e2e_secret_1"

COUNTS_SQL = f"""
SELECT
  (SELECT COUNT(*) FROM policy_rules WHERE workspace_id='{WS}') AS rules,
  (SELECT COUNT(*) FROM connect_grants WHERE workspace_id='{WS}') AS grants,
  (SELECT COUNT(*) FROM agent_runs WHERE workspace_id='{WS}') AS runs,
  (SELECT COUNT(*) FROM agent_events WHERE workspace_id='{WS}') AS events,
  (SELECT COUNT(*) FROM policy_decisions WHERE workspace_id='{WS}') AS decisions,
  (SELECT COUNT(*) FROM idempotency_keys WHERE workspace_id='{WS}') AS idem,
  (SELECT COUNT(*) FROM connect_audit_events WHERE workspace_id='{WS}') AS audit,
  (SELECT COUNT(*) FROM agents WHERE workspace_id='{WS}') AS agents,
  (SELECT COUNT(*) FROM connect_connections WHERE workspace_id='{WS}') AS connections
"""


def jwt_secret() -> str:
    for line in Path(".dev.vars").read_text().splitlines():
        if line.startswith("JWT_SECRET="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("JWT_SECRET not found in .dev.vars")


def d1(sql: str):
    proc = subprocess.run(
        ["uv", "run", "pywrangler", "d1", "execute", "runmesh-db", "--local", "--json", "--command", sql],
        capture_output=True, text=True, check=False,
    )
    out = proc.stdout + proc.stderr
    if proc.returncode != 0:
        raise SystemExit(f"d1 failed ({proc.returncode}): {out[-800:]}")
    dec = json.JSONDecoder()
    idx = 0
    while True:
        i = out.find("[", idx)
        if i < 0:
            raise SystemExit(f"no JSON in d1 output: {out[-800:]}")
        try:
            value, _ = dec.raw_decode(out, i)
            return value
        except ValueError:
            idx = i + 1


def rows_of(result) -> list:
    if isinstance(result, list) and result and isinstance(result[0], dict) and "results" in result[0]:
        merged = []
        for chunk in result:
            merged.extend(chunk.get("results") or [])
        return merged
    return result if isinstance(result, list) else []


def q(sql: str) -> list:
    return rows_of(d1(sql))


def esc(value: str) -> str:
    return value.replace("'", "''")


def main() -> None:
    sys.path.insert(0, "src")
    mode = sys.argv[1] if len(sys.argv) > 1 else ""

    if mode == "t0":
        print(datetime.now(timezone.utc).isoformat())

    elif mode == "counts":
        print(json.dumps(q(COUNTS_SQL)[0]))

    elif mode == "encrypt":
        from utils.connect_crypto import encrypt_connect_secret

        print(encrypt_connect_secret(sys.argv[2], jwt_secret()))

    elif mode == "jwt":
        from utils.auth import encode_token

        user = q(f"SELECT id, email, name FROM users WHERE id='{USER_ID}'")[0]
        token = encode_token(
            {"id": user["id"], "email": user["email"], "name": user["name"], "api_key_workspace_id": WS},
            jwt_secret(),
            ttl_seconds=4 * 3600,
        )
        print(token)

    elif mode == "seed":
        from utils.connect_crypto import encrypt_connect_secret

        enc = esc(encrypt_connect_secret(TOKEN, jwt_secret()))
        now = datetime.now(timezone.utc).isoformat()
        q(f"DELETE FROM connect_connections WHERE id='{CONN}'")
        q(f"DELETE FROM connect_users WHERE id='{CU}'")
        q(
            "INSERT INTO connect_users (id, status, primary_email, primary_email_verified, created_at, updated_at) "
            f"VALUES ('{CU}','active','support-agent@acme.dev',1,'{now}','{now}')"
        )
        q(
            "INSERT INTO connect_connections (id, connect_user_id, provider, status, scopes, access_token_enc, "
            "metadata, created_at, updated_at, workspace_id) VALUES "
            f"('{CONN}','{CU}','support','active','[]','{enc}','{{}}','{now}','{now}','{WS}')"
        )
        print("seeded")

    elif mode == "cleanup":
        t0 = esc(sys.argv[2])
        q(
            f"""
            DELETE FROM agent_events WHERE run_id IN (
              SELECT id FROM agent_runs WHERE agent_id IN
                (SELECT id FROM agents WHERE workspace_id='{WS}' AND external_key LIKE 'support-%'));
            DELETE FROM agent_runs WHERE agent_id IN
              (SELECT id FROM agents WHERE workspace_id='{WS}' AND external_key LIKE 'support-%');
            DELETE FROM agent_versions WHERE agent_id IN
              (SELECT id FROM agents WHERE workspace_id='{WS}' AND external_key LIKE 'support-%');
            DELETE FROM policy_decisions WHERE workspace_id='{WS}' AND created_at >= '{t0}';
            DELETE FROM connect_audit_events WHERE workspace_id='{WS}' AND created_at >= '{t0}';
            DELETE FROM policy_rules WHERE workspace_id='{WS}' AND created_at >= '{t0}';
            DELETE FROM connect_grants WHERE workspace_id='{WS}' AND connection_id='{CONN}';
            DELETE FROM idempotency_keys WHERE workspace_id='{WS}';
            DELETE FROM connect_sessions WHERE workspace_id='{WS}' AND created_at >= '{t0}';
            DELETE FROM tools WHERE workspace_id='{WS}' AND agent_id IN
              (SELECT id FROM agents WHERE workspace_id='{WS}' AND external_key LIKE 'support-%');
            DELETE FROM agents WHERE workspace_id='{WS}' AND external_key LIKE 'support-%';
            DELETE FROM connect_connections WHERE id='{CONN}';
            DELETE FROM connect_users WHERE id='{CU}';
            """
        )
        print("cleaned")

    elif mode == "sql":
        print(json.dumps(q(sys.argv[2])))

    else:
        raise SystemExit(f"unknown mode: {mode}")


if __name__ == "__main__":
    main()
