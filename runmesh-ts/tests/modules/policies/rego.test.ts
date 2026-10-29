import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ruleRego } from "../../../src/modules/policies/service.js";

interface RegoVector {
  input: {
    priority: number;
    name: string;
    action: string | null;
    conditions: string;
  };
  rego: string;
}

const vectors = JSON.parse(
  readFileSync(new URL("../../fixtures/rego-vectors.json", import.meta.url), "utf8"),
) as RegoVector[];

describe("compiled Rego artifact", () => {
  test("the fixture was generated from the Python reference", () => {
    expect(vectors.length).toBeGreaterThanOrEqual(10);
  });

  for (const vector of vectors) {
    test(`matches the oracle: ${vector.input.name}`, () => {
      expect(ruleRego(vector.input)).toBe(vector.rego);
    });
  }
});
