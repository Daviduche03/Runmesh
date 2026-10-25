"""Generate Rego-artifact parity vectors from the Python reference implementation.

The function bodies below are copied verbatim from
runmesh-main/src/services/policies.py (rule_rego / _parse_json_list); regenerate with:

    python3 scripts/gen-rego-vectors.py
"""
import json
import re

def _parse_json_list(value, field):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    try:
        parsed = json.loads(value)
    except Exception:
        raise ValueError(field)
    if not isinstance(parsed, list):
        raise ValueError(field)
    return parsed

def rule_rego(rule):
    op_map = {"is": "==", "is not": "!=", ">": ">", "<": "<", "contains": "contains"}
    clauses = []
    for condition in _parse_json_list(rule.get("conditions"), "conditions"):
        field = condition.get("field") or "action"
        operator = condition.get("operator") or "is"
        value = condition.get("value") or ""
        target = "input.tool.name" if field == "action" else f"input.{field}"
        op = op_map.get(operator, "==")
        if op == "contains":
            clauses.append(f"  contains({target}, {json.dumps(value)})")
        elif re.fullmatch(r"-?\d+(\.\d+)?", value):
            clauses.append(f"  {target} {op} {value}")
        else:
            clauses.append(f"  {target} {op} {json.dumps(value)}")
    body = "\n".join(clauses)
    return (
        "package runmesh.policy\n\n"
        "import rego.v1\n\n"
        'default decision := {"decision": "deny", "reason": "no rule matched"}\n\n'
        f"# {rule.get('priority')} · {rule.get('name')}\n"
        f'decision := {{"decision": {json.dumps(rule.get("action"))}}} if {{\n'
        f"{body}\n"
        "}\n"
    )

def cond(field, operator, value):
    return {"field": field, "operator": operator, "value": value}

INPUTS = [
    {"priority": 1, "name": "Deny GitHub", "action": "deny",
     "conditions": [cond("action", "is", "github")]},
    {"priority": 2, "name": "Spend cap", "action": "escalate",
     "conditions": [cond("amount", ">", "500")]},
    {"priority": 3, "name": "Fractional", "action": "escalate",
     "conditions": [cond("amount", ">", "12.50"), cond("amount", "<", "-3")]},
    {"priority": 4, "name": "Mixed", "action": "allow",
     "conditions": [cond("resource", "contains", "acme"), cond("agent", "is not", "bot"),
                    cond("scope", "is", "é"), cond("time", "<", "12.5"),
                    cond("user", "is", "")]},
    {"priority": 5, "name": "Unknown operator", "action": "consent",
     "conditions": [cond("action", "matches", "gh.*")]},
    {"priority": 6, "name": "Null value", "action": "deny",
     "conditions": [cond("action", "is", None)]},
    {"priority": 7, "name": "Emoji 🤖", "action": "deny",
     "conditions": [cond("resource", "is", "repo/🤖/main")]},
    {"priority": 8, "name": "No conditions", "action": "allow", "conditions": []},
    {"priority": 9, "name": "Operator length", "action": "escalate",
     "conditions": [cond("resource", "length >", "10")]},
    {"priority": 10, "name": "Empty conditions", "action": None, "conditions": []},
]

VECTORS = [
    {"input": dict(rule, conditions=json.dumps(rule["conditions"])), "rego": rule_rego(
        dict(rule, conditions=json.dumps(rule["conditions"])))}
    for rule in INPUTS
]

print(json.dumps(VECTORS, indent=2, ensure_ascii=True))
