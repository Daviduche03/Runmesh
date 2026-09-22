"""Managed tool calls: the enforced path.

Two shapes, one authorization path:

- ``invoke`` — the tool has no local implementation. The request is built from
  the registry (url + method) and the call's args; Runmesh executes it.
- ``forward`` — the tool keeps its own request (the dev's SDK builds it) and
  Runmesh forwards it, injecting the credential. The host is fixed by the
  registry's ``base_url``; the caller supplies only a path.

In both, policy decides against a context built from the registry (action) and
the live request, the connection's credential is decrypted in memory and never
returned, and responses are scrubbed of the injected secret.

Local tools never reach this module: they run in the caller's process and are
observed, not enforced.
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse

from fastapi import HTTPException

from workers import fetch

from db.orm import Model
from utils.responses import success
from utils.connect_crypto import decrypt_connect_secret
from services.workspaces import resolve_workspace_id
from services import policies as policies_service

RESPONSE_MAX = 8000
UPSTREAM_TIMEOUT_S = 30
BODY_MAX = 262144
HEADER_MAX = 40
HEADER_VALUE_MAX = 4096

FORWARD_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS")

# Never forward these: hop-by-hop, or the credential we are about to inject.
HOP_BY_HOP = frozenset({
    "host", "connection", "content-length", "transfer-encoding", "keep-alive",
    "upgrade", "te", "trailer", "proxy-authorization", "proxy-authenticate",
    "authorization",
})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_scopes(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return []
        return parsed if isinstance(parsed, list) else []
    return []


async def _kept(coro):
    """A ledger write that fails must never veto execution. Returns False when dropped."""
    try:
        await coro
        return True
    except Exception:
        return False


def _parse_json_dict(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _string_leaves(value) -> set:
    if isinstance(value, dict):
        leaves: set = set()
        for item in value.values():
            leaves |= _string_leaves(item)
        return leaves
    if isinstance(value, (list, tuple)):
        leaves = set()
        for item in value:
            leaves |= _string_leaves(item)
        return leaves
    if isinstance(value, str) and value.strip():
        return {value.strip().lower()}
    return set()


def _resource_allowed(filters: dict, resource: str) -> bool:
    """A resource-restricted grant covers only calls that name an allowed
    resource. If the call names none it cannot be verified, so it is refused."""
    if not filters:
        return True
    if not resource.strip():
        return False
    return resource.strip().lower() in _string_leaves(filters)


async def _resolve_grant(model: Model, workspace_id: str, connection_id: str, agent_id: str | None):
    """An agent-specific grant wins; otherwise the connection-wide (agent-less)
    grant the consent path mints."""
    base = (
        "workspace_id = ? AND connection_id = ? AND status = 'active' "
        "AND approval_status = 'approved'"
    )
    if agent_id:
        grant = await model.find_one(
            "connect_grants", base + " AND agent_id = ?", workspace_id, connection_id, agent_id
        )
        if grant is not None:
            return grant
    return await model.find_one(
        "connect_grants", base + " AND agent_id IS NULL", workspace_id, connection_id
    )


async def _refusal(model: Model, workspace_id: str, tool: dict, run: dict, agent_name: str,
                   cid: str | None, user_label: str, run_id: str, resource: str,
                   decision: str, reason: str) -> dict:
    ledger_ok = await _kept(policies_service.record_decision(
        db=model.db,
        workspace_id=workspace_id,
        rule_id=None,
        decision=decision,
        mode="none",
        enforced=True,
        default_applied=False,
        context={"action": tool.get("action") or "", "scope": "", "resource": resource,
                 "agent": agent_name, "user": user_label},
        agent_id=run["agent_id"],
        agent_label=agent_name,
        connect_user_id=cid,
        user_label=user_label,
        source="call",
        reason=reason,
        enforcement="proxied",
        run_id=run_id,
    ))
    return success({"decision": decision, "reason": reason, "rule": None, "ledger_ok": ledger_ok})


async def _record_event(model: Model, workspace_id: str, run_id: str, kind: str, name: str,
                        args: dict, result: dict, duration_ms: int) -> None:
    existing = await model.find_many("agent_events", "run_id = ?", run_id)
    seq = max([row.get("seq") or 0 for row in existing], default=0) + 1
    await model.insert("agent_events", {
        "id": f"evt_{uuid.uuid4().hex[:12]}",
        "workspace_id": workspace_id,
        "run_id": run_id,
        "seq": seq,
        "kind": kind,
        "name": name,
        "args": json.dumps(args or {}, default=str)[:RESPONSE_MAX],
        "result": json.dumps(result or {}, default=str)[:RESPONSE_MAX],
        "truncated": 0,
        "duration_ms": duration_ms,
        "created_at": _now(),
    })


def _inject_auth(headers: dict, tool: dict, token: str) -> dict:
    scheme = (tool.get("auth_scheme") or "none").lower()
    if scheme in ("bearer", "api_key", "basic"):
        header = tool.get("auth_header") or "Authorization"
        template = tool.get("auth_format") or "Bearer {token}"
        headers[header] = template.replace("{token}", token)
    return headers


def _sanitize_headers(raw, tool: dict) -> dict:
    """Forward the caller's headers minus hop-by-hop and any auth they sent —
    the credential is ours to attach, never theirs to override."""
    headers: dict = {}
    if isinstance(raw, dict):
        for key, value in list(raw.items())[:HEADER_MAX]:
            name = str(key).strip()
            if not name or len(name) > 128 or "\n" in name or "\r" in name:
                continue
            if name.lower() in HOP_BY_HOP:
                continue
            text = str(value)
            headers[name] = text[:HEADER_VALUE_MAX]
    return headers


def _forward_body(raw):
    if raw is None:
        return None
    if isinstance(raw, (dict, list)):
        return json.dumps(raw, default=str)[:BODY_MAX]
    return str(raw)[:BODY_MAX]


def _forward_url(tool: dict, path: str, query) -> str:
    base_url = tool.get("base_url")
    if not base_url:
        raise HTTPException(status_code=400, detail="Tool has no base_url; register it with baseUrl")
    clean = (path or "").strip()
    if not clean.startswith("/") or clean.startswith("//"):
        raise HTTPException(status_code=400, detail="path must be absolute and start with a single '/'")
    if any(ch in clean for ch in ("\n", "\r", " ")):
        raise HTTPException(status_code=400, detail="path contains illegal characters")
    url = base_url.rstrip("/") + clean
    # Path-relative by construction; assert the host anyway so a malformed
    # base_url can never turn this into an arbitrary-host request.
    if (urlparse(url).hostname or "").lower() != (urlparse(base_url).hostname or "").lower():
        raise HTTPException(status_code=400, detail="resolved host does not match the tool's base_url")
    if isinstance(query, dict) and query:
        url = f"{url}{'&' if '?' in url else '?'}{urlencode(query)}"
    return url


async def _idempotent_hit(model: Model, workspace_id: str, key: str | None):
    if not key:
        return None
    hit = await model.find_one(
        "idempotency_keys", "workspace_id = ? AND key = ?", workspace_id, key
    )
    if hit is None:
        return None
    try:
        cached = json.loads(hit.get("response") or "{}")
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(cached, dict) or not cached:
        return None
    cached = dict(cached)
    cached["idempotent_replay"] = True
    return success(cached)


async def _idempotent_store(model: Model, workspace_id: str, key: str | None, payload: dict):
    if not key:
        return None
    try:
        await model.insert("idempotency_keys", {
            "workspace_id": workspace_id,
            "key": key,
            "status": int(payload.get("status") or 0),
            "response": json.dumps(payload, default=str)[:RESPONSE_MAX],
            "created_at": _now(),
        })
        return None
    except Exception:
        # Lost a race: the winner's cached response is authoritative.
        return await _idempotent_hit(model, workspace_id, key)


async def _resolve_tool_and_run(model: Model, workspace_id: str, ref: str, run_id_raw: str):
    tool = await model.find_one("tools", "id = ? AND workspace_id = ?", ref, workspace_id)
    if tool is None:
        raise HTTPException(status_code=404, detail="Tool not found")
    if tool.get("kind") != "managed":
        raise HTTPException(status_code=400, detail="Tool is not managed; local tools run in-process")
    run_id = (run_id_raw or "").strip()
    if not run_id:
        raise HTTPException(status_code=400, detail="run_id is required")
    run = await model.find_one("agent_runs", "id = ? AND workspace_id = ?", run_id, workspace_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    agent = await model.find_one("agents", "id = ?", run["agent_id"])
    agent_name = (agent or {}).get("name") or run["agent_id"]
    return tool, run, agent_name, run_id


async def _prepare_call(env, model: Model, workspace_id: str, tool: dict, run: dict,
                        agent_name: str, run_id: str, *, connect_user_id, resource: str) -> dict:
    """Resolve credential + policy. Returns ``{"early": response}`` to stop, or
    ``{"token", "connect_user_id", "user_label", "ledger_ok"}`` to proceed."""
    provider = tool.get("provider")
    ledger_ok = True

    where = "workspace_id = ? AND provider = ? AND status = 'active'"
    params: list = [workspace_id, provider]
    if connect_user_id:
        where += " AND connect_user_id = ?"
        params.append(connect_user_id)
    else:
        peers = await model.find_many("connect_connections", where, *params)
        if len(peers) > 1:
            raise HTTPException(
                status_code=400,
                detail=f"Multiple active {provider} connections; specify connect_user_id",
            )
    connection = await model.find_one("connect_connections", where, *params)

    if connection is None:
        ledger_ok = await _kept(policies_service.record_decision(
            db=model.db,
            workspace_id=workspace_id,
            rule_id=None,
            decision="consent",
            mode="none",
            enforced=False,
            default_applied=False,
            context={"action": tool.get("action") or "", "scope": "", "resource": "", "agent": agent_name, "user": ""},
            agent_id=run["agent_id"],
            agent_label=agent_name,
            source="call",
            reason=f"No active {provider} connection for this user.",
            enforcement="proxied",
            run_id=run_id,
        )) and ledger_ok
        return {"early": success({
            "decision": "consent",
            "provider": provider,
            "reason": f"Connect {provider} to let this agent act on your behalf.",
            "ledger_ok": ledger_ok,
        })}

    cid = connection.get("connect_user_id")
    connect_user = await model.find_one("connect_users", "id = ?", cid) if cid else None
    user_label = (connect_user or {}).get("primary_email") or connection.get("provider_account_label") or ""
    scopes = _parse_scopes(connection.get("scopes"))

    try:
        outcome = await policies_service.enforce_grant_issuance(
            model.db,
            workspace_id=workspace_id,
            provider=provider,
            scopes=scopes,
            resource=resource,
            agent_id=run["agent_id"],
            agent_label=agent_name,
            connect_user_id=cid,
            user_label=user_label,
            source="call",
            restrictive=False,
            action_override=tool.get("action"),
            enforcement="proxied",
            run_id=run_id,
            strict_record=False,
        )
    except HTTPException as http_err:
        # All request validation happens before this point, so an HTTP error
        # from inside evaluation is a 500-class store problem (corrupt rule
        # JSON). Fail closed, never a raw 500.
        if getattr(http_err, "status_code", 500) >= 500:
            return {"early": success({
                "decision": "deny",
                "reason": "Policy evaluation failed; failing closed.",
                "rule": None,
                "ledger_ok": False,
            })}
        raise
    except Exception:
        return {"early": success({
            "decision": "deny",
            "reason": "Policy evaluation failed; failing closed.",
            "rule": None,
            "ledger_ok": False,
        })}
    ledger_ok = ledger_ok and bool(outcome.get("ledger_ok", True))

    if outcome["decision"] != "allow":
        return {"early": success({
            "decision": outcome["decision"],
            "reason": outcome["reason"],
            "rule": (outcome.get("rule") or {}).get("name"),
            "ledger_ok": ledger_ok,
        })}

    # The grant is the agent's authority. Without one there is nothing to
    # exercise; with one, its limits are enforced rather than ignored.
    grant = await _resolve_grant(model, workspace_id, connection["id"], run["agent_id"])
    if grant is None:
        ledger_ok = await _kept(policies_service.record_decision(
            db=model.db,
            workspace_id=workspace_id,
            rule_id=None,
            decision="consent",
            mode="none",
            enforced=False,
            default_applied=False,
            context={"action": tool.get("action") or "", "scope": "", "resource": resource,
                     "agent": agent_name, "user": user_label},
            agent_id=run["agent_id"],
            agent_label=agent_name,
            connect_user_id=cid,
            user_label=user_label,
            source="call",
            reason=f"No grant covers {agent_name} on this connection.",
            enforcement="proxied",
            run_id=run_id,
        )) and ledger_ok
        return {"early": success({
            "decision": "consent",
            "provider": provider,
            "reason": f"Grant {provider} access to this agent before it can act.",
            "ledger_ok": ledger_ok,
        })}

    now = _now()
    valid_until = grant.get("valid_until")
    if valid_until and str(valid_until) <= now:
        return {"early": await _refusal(
            model, workspace_id, tool, run, agent_name, cid, user_label, run_id, resource,
            "deny", "The grant has expired.")}
    max_uses = grant.get("max_uses")
    use_count = int(grant.get("use_count") or 0)
    if max_uses is not None and use_count >= int(max_uses):
        return {"early": await _refusal(
            model, workspace_id, tool, run, agent_name, cid, user_label, run_id, resource,
            "deny", "The grant has no uses left.")}
    if not _resource_allowed(_parse_json_dict(grant.get("resource_filters")), resource):
        return {"early": await _refusal(
            model, workspace_id, tool, run, agent_name, cid, user_label, run_id, resource,
            "deny", "The grant does not cover this resource.")}

    # Reserve a use. Best-effort so a counter write cannot veto an allowed
    # call, but the outcome is reported in ledger_ok.
    try:
        await model.update(
            "connect_grants", "id = ?",
            {"use_count": use_count + 1, "updated_at": now}, grant["id"],
        )
    except Exception:
        ledger_ok = False

    token = decrypt_connect_secret(connection.get("access_token_enc"), env.JWT_SECRET)
    if not token:
        return {"early": success({
            "decision": "consent",
            "provider": provider,
            "reason": f"The {provider} connection has no usable credential; reconnect it.",
            "ledger_ok": ledger_ok,
        })}

    return {
        "token": token,
        "connect_user_id": cid,
        "user_label": user_label,
        "ledger_ok": ledger_ok,
    }


async def _execute_and_record(env, model: Model, workspace_id: str, run_id: str, tool: dict,
                              request_args: dict, method: str, url: str, headers: dict, body,
                              token: str, idem_key: str | None, ledger_ok: bool) -> dict:
    started = _now()
    try:
        response = await asyncio.wait_for(
            fetch(url, method=method, headers=headers, body=body),
            timeout=UPSTREAM_TIMEOUT_S,
        )
        status = int(getattr(response, "status", 0) or 0)
        text = await response.text()
    except Exception as error:  # network/upstream failure is not a policy denial
        ledger_ok = await _kept(_record_event(
            model, workspace_id, run_id, "error", tool["name"], request_args,
            {"message": str(error)}, 0)) and ledger_ok
        return success({
            "decision": "allow", "status": 502, "upstream_error": True,
            "result": {"error": "upstream_unreachable", "message": str(error)},
            "body": json.dumps({"error": "upstream_unreachable", "message": str(error)}),
            "ledger_ok": ledger_ok,
        })

    scrubbed = text.replace(token, "[REDACTED]") if token else text
    truncated = len(scrubbed) > RESPONSE_MAX
    scrubbed = scrubbed[:RESPONSE_MAX]
    try:
        result = json.loads(scrubbed)
    except (TypeError, json.JSONDecodeError):
        result = {"body": scrubbed}
    if truncated:
        result = {"truncated": True, "body": result}

    try:
        duration_ms = int((datetime.now(timezone.utc) - datetime.fromisoformat(started)).total_seconds() * 1000)
    except (TypeError, ValueError):
        duration_ms = 0
    # The side effect already happened: a ledger failure here must not turn a
    # success into a 500. Flag it and return the result.
    ledger_ok = await _kept(_record_event(
        model, workspace_id, run_id, "tool.result", tool["name"], request_args,
        result, duration_ms)) and ledger_ok

    payload = {
        "decision": "allow",
        "status": status,
        "upstream_error": status >= 400,
        "result": result,
        "body": scrubbed,
        "ledger_ok": ledger_ok,
    }
    raced = await _idempotent_store(model, workspace_id, idem_key, payload)
    return raced if raced is not None else success(payload)


async def list_tools(env, user_id: str, workspace_id: str) -> dict:
    """Registered tools in this workspace: the formal action vocabulary.

    Each row carries the `action` string policy evaluates on the call path
    (`provider.action`), so rule editors can offer it instead of free text.
    """
    db = env.DB
    model = Model(db)
    workspace_id = await resolve_workspace_id(db, user_id, workspace_id)
    rows = await model.find_many("tools", "workspace_id = ? ORDER BY name ASC", workspace_id)
    return success([
        {
            "id": row["id"],
            "name": row.get("name") or row["id"],
            "action": row.get("action") or "",
            "kind": row.get("kind") or "local",
            "provider": row.get("provider") or "",
        }
        for row in rows
    ])


async def invoke_tool(env, user_id: str, workspace_id: str, ref: str, req) -> dict:
    db = env.DB
    model = Model(db)
    workspace_id = await resolve_workspace_id(db, user_id, workspace_id)
    tool, run, agent_name, run_id = await _resolve_tool_and_run(model, workspace_id, ref, req.run_id)

    args = req.args if isinstance(req.args, dict) else {}
    resource = str(args.get(tool.get("resource_param")) or "") if tool.get("resource_param") else ""

    # Replay check first: a retry must not reserve a second grant use.
    idem_key = (req.idempotency_key or "").strip() or None
    cached = await _idempotent_hit(model, workspace_id, idem_key)
    if cached is not None:
        return cached

    prep = await _prepare_call(
        env, model, workspace_id, tool, run, agent_name, run_id,
        connect_user_id=req.connect_user_id, resource=resource,
    )
    if prep.get("early") is not None:
        return prep["early"]
    token = prep["token"]
    ledger_ok = prep["ledger_ok"]

    url = tool.get("url")
    method = tool.get("method") or "POST"
    headers = _inject_auth({"Content-Type": "application/json"}, tool, token)
    if idem_key:
        headers["Idempotency-Key"] = idem_key

    body = None
    if method == "GET":
        if args:
            url = f"{url}{'&' if '?' in url else '?'}{urlencode(args)}"
    else:
        body = json.dumps(args)

    return await _execute_and_record(
        env, model, workspace_id, run_id, tool, args, method, url, headers, body,
        token, idem_key, ledger_ok,
    )


async def forward_tool(
    env, user_id: str, workspace_id: str, ref: str,
    *, method: str, path: str, headers=None, body=None, query=None,
    run_id: str = "", idempotency_key=None, connect_user_id=None,
) -> dict:
    """Forward the caller's own request with the credential injected.

    The host comes from the tool's base_url; the caller supplies only a path,
    so this cannot be turned into an arbitrary-host request.
    """
    db = env.DB
    model = Model(db)
    workspace_id = await resolve_workspace_id(db, user_id, workspace_id)
    tool, run, agent_name, resolved_run_id = await _resolve_tool_and_run(
        model, workspace_id, ref, run_id
    )

    verb = (method or "GET").strip().upper()
    if verb not in FORWARD_METHODS:
        raise HTTPException(status_code=400, detail=f"method must be one of {', '.join(FORWARD_METHODS)}")
    url = _forward_url(tool, path, query)

    # Replay check first: a retry must not reserve a second grant use.
    idem_key = (idempotency_key or "").strip() or None
    cached = await _idempotent_hit(model, workspace_id, idem_key)
    if cached is not None:
        return cached

    prep = await _prepare_call(
        env, model, workspace_id, tool, run, agent_name, resolved_run_id,
        connect_user_id=connect_user_id, resource="",
    )
    if prep.get("early") is not None:
        return prep["early"]
    token = prep["token"]
    ledger_ok = prep["ledger_ok"]

    outbound = _inject_auth(_sanitize_headers(headers, tool), tool, token)
    outbound.setdefault("Content-Type", "application/json")
    if idem_key:
        outbound["Idempotency-Key"] = idem_key

    request_args = {"method": verb, "path": path}
    return await _execute_and_record(
        env, model, workspace_id, resolved_run_id, tool, request_args, verb, url,
        outbound, _forward_body(body), token, idem_key, ledger_ok,
    )
