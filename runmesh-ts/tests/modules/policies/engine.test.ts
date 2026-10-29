/**
 * Parity suite: every vector was produced by the Python engine
 * (`scripts/gen-policy-vectors.py`). The TypeScript engine must reproduce the decision, the
 * trace and the shadow list exactly, or authorization diverges silently at cutover.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildGrantContext,
  changeHint,
  evaluate,
  serializeEvaluation,
} from "../../../src/modules/policies/engine.js";
import type { EvaluationWire, PolicyContext, PolicyRule } from "../../../src/modules/policies/engine.js";

interface Vector {
  name: string;
  rules: PolicyRule[];
  context: PolicyContext;
  result: EvaluationWire;
}

interface GrantVector {
  name: string;
  input: Parameters<typeof buildGrantContext>[0];
  result: PolicyContext;
}

const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dir, "../../fixtures/policy-vectors.json"), "utf8"),
) as { engine: string; cases: Vector[]; grantContexts: GrantVector[] };

describe("policy engine parity with the Python oracle", () => {
  test("vectors were generated from the Python engine", () => {
    expect(fixture.engine).toBe("legacy/runmesh-main/src/services/policy_engine.py");
    expect(fixture.cases.length).toBeGreaterThan(40);
  });

  for (const vector of fixture.cases) {
    test(vector.name, () => {
      expect(serializeEvaluation(evaluate(vector.rules, vector.context))).toEqual(vector.result);
    });
  }

  for (const vector of fixture.grantContexts) {
    test(`grant context: ${vector.name}`, () => {
      expect(buildGrantContext(vector.input)).toEqual(vector.result);
    });
  }
});

describe("policy engine invariants", () => {
  const context: PolicyContext = buildGrantContext({
    provider: "github",
    scopes: ["repo:read"],
    agent: "agent_1",
  });

  test("a log-only match never settles a decision", () => {
    const evaluation = evaluate(
      [
        {
          id: "watch",
          priority: 1,
          name: "watch",
          action: "deny",
          mode: "log-only",
          enabled: true,
          conditions: [],
        },
      ],
      context,
    );
    expect(evaluation.settled).toBe(false);
    expect(evaluation.defaultApplied).toBe(true);
    expect(evaluation.shadowed.map((rule) => rule.id)).toEqual(["watch"]);
  });

  test("a later enable rule replaces an earlier log-only shadow", () => {
    const evaluation = evaluate(
      [
        { id: "watch", priority: 1, action: "deny", mode: "log-only", enabled: true, conditions: [] },
        { id: "live", priority: 2, action: "allow", enabled: true, conditions: [] },
      ],
      context,
    );
    expect(evaluation.decision).toBe("allow");
    expect(evaluation.rule?.id).toBe("live");
    expect(evaluation.shadowed.map((rule) => rule.id)).toEqual(["watch"]);
  });

  test("the wire shape is snake_case", () => {
    const wire = serializeEvaluation(evaluate([], context));
    expect(Object.keys(wire).sort()).toEqual([
      "decision",
      "default_applied",
      "rule",
      "settled",
      "shadowed",
      "steps",
    ]);
  });

  test("change hints point at the matched rule", () => {
    expect(changeHint("allow", null)).toContain("Nothing needs to change");
    expect(changeHint("escalate", null, "250")).toContain("$250");
    expect(changeHint("consent", null)).toContain("standing grant");
    expect(changeHint("deny", { id: "r1", priority: 7 })).toContain("#7");
    expect(changeHint("deny", null)).toContain("blocked only by the default");
  });
});
