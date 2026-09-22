"""Pure policy evaluation. No DB, no HTTP.

The engine takes a context dict that callers build from *server-verified*
facts. The action identity for a security decision is never taken from the
caller's label — it is derived here from the connection (or, later, the
registered tool catalog). That is the whole point: the thing being enforced
must not get to name itself.
"""

import re

POLICY_ACTIONS = ("allow", "escalate", "consent", "deny")
POLICY_MODES = ("enforce", "log-only")
POLICY_FIELDS = ("action", "agent", "scope", "resource", "user", "amount", "time")
POLICY_OPERATORS = ("is", "is not", "contains", ">", "<", "within")
POLICY_REVERSIBILITY = ("reversible", "undoable", "irreversible")


def build_action_identity(provider: str | None) -> str:
    """Canonical action for a grant, derived from the connection row.

    At issuance the unit of authority is a provider connection, so the action
    is the provider (``github``, ``stripe``). Tool-level actions such as
    ``stripe.charge`` belong to the call path, where the identity is derived
    from the registered tool catalog — never from a runtime string the
    wrapped agent supplies.
    """
    return (provider or "").strip().lower()


def build_grant_context(
    *,
    provider: str | None,
    scopes,
    resource: str = "",
    agent: str = "",
    user: str = "",
    amount: str = "",
    when: str = "",
) -> dict:
    """Build the evaluation context from verified fields only."""
    normalized = sorted({str(s).strip().lower() for s in (scopes or []) if str(s).strip()})
    return {
        "action": build_action_identity(provider),
        "scope": ", ".join(normalized),
        "resource": str(resource or ""),
        "agent": str(agent or ""),
        "user": str(user or ""),
        "amount": str(amount or ""),
        "time": str(when or ""),
    }


def context_value(field: str, context: dict) -> str:
    return str(context.get(field) or "")


def condition_matches(condition: dict, context: dict) -> bool:
    actual = context_value(condition.get("field") or "action", context)
    expected = str(condition.get("value") or "")
    operator = condition.get("operator") or "is"
    if operator == "is":
        return actual == expected
    if operator == "is not":
        return actual != expected
    if operator == "contains":
        return expected in actual
    if operator in (">", "<"):
        try:
            left = float(re.sub(r"[^0-9.\-]", "", actual) or "nan")
            right = float(re.sub(r"[^0-9.\-]", "", expected) or "nan")
        except ValueError:
            return False
        return left > right if operator == ">" else left < right
    # `within` needs a clock context we do not carry yet; treat as containment
    # and let the trace say so.
    return expected in actual


def evaluate(rules: list[dict], context: dict) -> dict:
    """Walk rules in priority order, first match wins.

    Disabled rules are skipped. A matched ``log-only`` rule is recorded as a
    shadow and does not decide — evaluation continues, which is what makes
    "watch before it acts" true. Unmatched falls to the engine default (deny).

    Returns ``{decision, rule, settled, default_applied, steps, shadowed}``
    where ``settled`` means an enforce-mode rule actually decided.
    """
    steps: list[dict] = []
    shadowed: list[dict] = []
    decision: str | None = None
    matched: dict | None = None

    for rule in rules:
        if decision is not None:
            steps.append({
                "id": rule.get("id"),
                "priority": rule.get("priority"),
                "name": rule.get("name") or "",
                "action": rule.get("action"),
                "status": "not-reached",
                "detail": "First match already decided.",
            })
            continue
        if not rule.get("enabled"):
            steps.append({
                "id": rule.get("id"),
                "priority": rule.get("priority"),
                "name": rule.get("name") or "",
                "action": rule.get("action"),
                "status": "disabled",
                "detail": "Disabled. Not evaluating.",
            })
            continue
        failing = next(
            (c for c in (rule.get("conditions") or []) if not condition_matches(c, context)),
            None,
        )
        if failing is not None:
            actual = context_value(failing.get("field") or "action", context) or "—"
            steps.append({
                "id": rule.get("id"),
                "priority": rule.get("priority"),
                "name": rule.get("name") or "",
                "action": rule.get("action"),
                "status": "skipped",
                "detail": (
                    f"{actual} does not satisfy {failing.get('field')} "
                    f"{failing.get('operator')} {failing.get('value')}"
                ),
            })
            continue
        if (rule.get("mode") or "enforce") == "log-only":
            shadowed.append({
                "id": rule.get("id"),
                "priority": rule.get("priority"),
                "name": rule.get("name") or "",
                "action": rule.get("action"),
            })
            steps.append({
                "id": rule.get("id"),
                "priority": rule.get("priority"),
                "name": rule.get("name") or "",
                "action": rule.get("action"),
                "status": "shadow",
                "detail": "Log-only. Recorded, not enforced.",
            })
            continue
        decision = rule.get("action")
        matched = rule
        steps.append({
            "id": rule.get("id"),
            "priority": rule.get("priority"),
            "name": rule.get("name") or "",
            "action": rule.get("action"),
            "status": "matched",
            "detail": "All conditions matched.",
        })

    if decision is None:
        return {
            "decision": "deny",
            "rule": None,
            "settled": False,
            "default_applied": True,
            "steps": steps,
            "shadowed": shadowed,
        }
    return {
        "decision": decision,
        "rule": matched,
        "settled": True,
        "default_applied": False,
        "steps": steps,
        "shadowed": shadowed,
    }


def change_hint(decision: str, rule: dict | None, request_amount: str = "") -> str:
    if decision == "allow":
        return "Nothing needs to change. This runs without a human."
    if decision == "escalate":
        return f"Allow it automatically by raising the spend cap above ${request_amount}."
    if decision == "consent":
        return "A standing grant covering this scope would let it proceed without asking."
    if rule and rule.get("priority") is not None:
        return f"Nothing overrides this. Move #{rule['priority']} below another rule to change the outcome."
    return "Add a rule that covers this action. Today it is blocked only by the default."
