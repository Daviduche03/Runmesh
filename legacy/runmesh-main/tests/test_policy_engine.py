"""Policy engine condition/operator tests.

Run: cd runmesh-main && PYTHONPATH=src uv run --no-sync python tests/test_policy_engine.py
"""
from services import policy_engine as pe

results = []


def check(name, cond, detail=""):
    results.append((name, cond))
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {detail}")


def ctx(**over):
    base = pe.build_grant_context(
        provider="support", scopes=["refund.issue"], resource="valid_billing_error"
    )
    base.update(over)
    return base


def m(field, operator, value, context=None):
    return pe.condition_matches(
        {"field": field, "operator": operator, "value": value}, context or ctx()
    )


check("is", m("resource", "is", "valid_billing_error"))
check("is not", m("resource", "is not", "abuse"))
check("contains", m("resource", "contains", "billing"))
check("not contains", m("resource", "not contains", "abuse"))
check("matches", m("resource", "matches", r"^valid_.*error$"))
check("matches: invalid regex is false", not m("resource", "matches", "("))
check("in", m("resource", "in", "valid_billing_error, goodwill"))
check("not in", m("resource", "not in", "abuse, goodwill"))
check("starts with", m("resource", "starts with", "valid"))
check("ends with", m("resource", "ends with", "error"))
check("length >", m("resource", "length >", "5"))
check("length < false", not m("resource", "length <", "5"))
check("numeric >", m("amount", ">", "10", ctx(amount="240")))
check("numeric <", m("amount", "<", "500", ctx(amount="240")))
check("numeric >: non-numeric is false", not m("amount", ">", "10", ctx(amount="lots")))

# Multiple conditions are ANDed; first match wins.
rules = [
    {"id": "a", "priority": 1, "enabled": True, "action": "allow",
     "conditions": [{"field": "action", "operator": "is", "value": "support"},
                    {"field": "resource", "operator": "is", "value": "valid_billing_error"}]},
    {"id": "b", "priority": 2, "enabled": True, "action": "escalate",
     "conditions": [{"field": "action", "operator": "is", "value": "support"}]},
]
allow = pe.evaluate(rules, ctx())
escalate = pe.evaluate(rules, ctx(resource="goodwill"))
check("AND: allow when both match", allow["decision"] == "allow", allow["decision"])
check("AND: escalate when resource differs", escalate["decision"] == "escalate", escalate["decision"])

failed = [name for name, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} passed")
if failed:
    raise SystemExit(f"FAILED: {failed}")
