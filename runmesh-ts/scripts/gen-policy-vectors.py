#!/usr/bin/env python3
"""Generate policy evaluation vectors from the Python oracle.

Run from the repo root:

    python3 runmesh-ts/scripts/gen-policy-vectors.py

The output (tests/fixtures/policy-vectors.json) is committed. The TypeScript engine must
reproduce every vector exactly — this is authorization logic, and "looks equivalent" is not
good enough.
"""
from __future__ import annotations

import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve()
REPO_ROOT = HERE.parents[2]
sys.path.insert(0, str(REPO_ROOT / "runmesh-main" / "src" / "services"))

import policy_engine as engine  # noqa: E402

OUT = HERE.parents[1] / "tests" / "fixtures" / "policy-vectors.json"

BASE_CONTEXT = {
    "action": "github",
    "scope": "repo:read, issues:write",
    "resource": "org/repo",
    "agent": "agent_1",
    "user": "u_1",
    "amount": "",
    "time": "",
}


def rule(rid, priority, action, conditions, *, mode="enforce", enabled=True, name=None):
    return {
        "id": rid,
        "priority": priority,
        "name": name if name is not None else rid,
        "action": action,
        "mode": mode,
        "enabled": enabled,
        "conditions": conditions,
    }


def cond(field, operator, value):
    return {"field": field, "operator": operator, "value": value}


CASES = [
    {"name": "no rules falls to default deny", "rules": [], "context": BASE_CONTEXT},
    {"name": "allow-all rule", "rules": [rule("r1", 1, "allow", [])], "context": BASE_CONTEXT},
    {
        "name": "first match wins, later rules are not reached",
        "rules": [
            rule("r1", 1, "allow", [cond("action", "is", "github")]),
            rule("r2", 2, "deny", []),
            rule("r3", 3, "deny", [], enabled=False),
        ],
        "context": BASE_CONTEXT,
    },
    {
        "name": "disabled rule is skipped",
        "rules": [
            rule("r1", 1, "deny", [], enabled=False),
            rule("r2", 2, "allow", []),
        ],
        "context": BASE_CONTEXT,
    },
    {
        "name": "log-only rule is shadowed, a later rule decides",
        "rules": [
            rule("r1", 1, "deny", [], mode="log-only"),
            rule("r2", 2, "allow", []),
        ],
        "context": BASE_CONTEXT,
    },
    {
        "name": "only a log-only rule still falls to the default",
        "rules": [rule("r1", 1, "deny", [], mode="log-only")],
        "context": BASE_CONTEXT,
    },
    {
        "name": "failing condition reports the actual value",
        "rules": [rule("r1", 1, "allow", [cond("agent", "is", "other_agent")])],
        "context": BASE_CONTEXT,
    },
    {
        "name": "missing field defaults to the action",
        "rules": [rule("r1", 1, "allow", [{"operator": "is", "value": "github"}])],
        "context": BASE_CONTEXT,
    },
    {
        "name": "missing operator defaults to is",
        "rules": [rule("r1", 1, "allow", [{"field": "action", "value": "github"}])],
        "context": BASE_CONTEXT,
    },
    {
        "name": "missing enabled means disabled",
        "rules": [{"id": "r1", "priority": 1, "name": "r1", "action": "allow", "conditions": []}],
        "context": BASE_CONTEXT,
    },
    {
        "name": "missing mode means enforce",
        "rules": [
            {"id": "r1", "priority": 1, "name": "r1", "action": "allow", "enabled": True, "conditions": []}
        ],
        "context": BASE_CONTEXT,
    },
    {
        "name": "two conditions must both match",
        "rules": [
            rule(
                "r1",
                1,
                "allow",
                [cond("action", "is", "github"), cond("resource", "is", "org/repo")],
            )
        ],
        "context": BASE_CONTEXT,
    },
    {
        "name": "two conditions with one failing",
        "rules": [
            rule(
                "r1",
                1,
                "allow",
                [cond("action", "is", "github"), cond("resource", "is", "other/repo")],
            )
        ],
        "context": BASE_CONTEXT,
    },
    {
        "name": "matched enforce rule without an action still defaults",
        "rules": [
            {
                "id": "r1",
                "priority": 1,
                "name": "r1",
                "mode": "enforce",
                "enabled": True,
                "conditions": [],
            }
        ],
        "context": BASE_CONTEXT,
    },
    {
        "name": "consent action",
        "rules": [rule("r1", 1, "consent", [])],
        "context": BASE_CONTEXT,
    },
    {
        "name": "escalate action",
        "rules": [rule("r1", 1, "escalate", [])],
        "context": BASE_CONTEXT,
    },
]

OP_CASES = [
    ("is", "action", "github", "gitlab"),
    ("is not", "action", "gitlab", "github"),
    ("contains", "scope", "issues", "admin"),
    ("not contains", "scope", "admin", "issues"),
    ("matches", "action", "^git", "^hub"),
    ("in", "action", "gitlab, github, stripe", "bitbucket, gitea"),
    ("not in", "action", "gitlab, stripe", "github, stripe"),
    ("starts with", "action", "git", "hub"),
    ("ends with", "action", "hub", "lab"),
    ("length >", "action", "3", "10"),
    ("length <", "action", "10", "3"),
    (">", "amount", "500", "5000"),
    ("<", "amount", "5000", "500"),
    ("within", "scope", "repo", "admin"),
]

for operator, field, passing, failing in OP_CASES:
    context = dict(BASE_CONTEXT)
    if field == "amount":
        context["amount"] = "1200"
    CASES.append(
        {
            "name": f"operator {operator!r} matches",
            "rules": [rule("r1", 1, "allow", [cond(field, operator, passing)])],
            "context": context,
        }
    )
    CASES.append(
        {
            "name": f"operator {operator!r} does not match",
            "rules": [rule("r1", 1, "allow", [cond(field, operator, failing)])],
            "context": dict(context),
        }
    )

CASES.extend(
    [
        {
            "name": "invalid regex never matches",
            "rules": [rule("r1", 1, "allow", [cond("action", "matches", "([")])],
            "context": BASE_CONTEXT,
        },
        {
            "name": "length bound must be an integer",
            "rules": [rule("r1", 1, "allow", [cond("action", "length >", "3.5")])],
            "context": BASE_CONTEXT,
        },
        {
            "name": "numeric comparison ignores currency formatting",
            "rules": [rule("r1", 1, "allow", [cond("amount", ">", "$500")])],
            "context": {**BASE_CONTEXT, "amount": "$1,200"},
        },
    ]
)

GRANT_CONTEXTS = [
    {
        "name": "scopes are lowercased, trimmed, deduped and sorted",
        "input": {
            "provider": "GitHub",
            "scopes": ["repo:read", " Issues:Write ", "repo:read", ""],
            "resource": "org/repo",
            "agent": "agent_1",
            "user": "u_1",
        },
    },
    {
        "name": "missing provider and scopes",
        "input": {"provider": None, "scopes": None},
    },
    {
        "name": "provider whitespace is trimmed",
        "input": {"provider": "  Stripe  ", "scopes": ["charges:write"]},
    },
]


def main() -> None:
    cases = []
    for case in CASES:
        result = engine.evaluate(case["rules"], case["context"])
        cases.append({**case, "result": result})

    grant_contexts = [
        {"name": item["name"], "input": item["input"], "result": engine.build_grant_context(**item["input"])}
        for item in GRANT_CONTEXTS
    ]

    payload = {"engine": "runmesh-main/src/services/policy_engine.py", "cases": cases, "grantContexts": grant_contexts}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")
    print(f"wrote {len(cases)} cases and {len(grant_contexts)} grant contexts to {OUT}")


if __name__ == "__main__":
    main()
