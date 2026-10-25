import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  agents,
  connectAuditEvents,
  connectUsers,
  policyDecisions,
  tools,
} from "../../../src/core/db/schema.js";
import {
  enforceGrantIssuance,
  recordDecision,
} from "../../../src/modules/policies/service.js";
import { ensurePersonalWorkspace } from "../../../src/modules/workspace/tenancy.js";
import {
  createTestUser,
  getJson,
  postJson,
  startTestApp,
} from "../../helpers/test-app.js";
import type { TestApp, TestUser } from "../../helpers/test-app.js";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp("policies");
});

afterAll(async () => {
  await app.close();
});

async function workspaceUser(email: string): Promise<{ user: TestUser; workspaceId: string }> {
  const user = await createTestUser(app, email);
  const workspaceId = ensurePersonalWorkspace(app.handle.db, user.id);
  return { user, workspaceId };
}

const createRule = (
  token: string,
  body: Record<string, unknown>,
  workspaceId?: string,
) => postJson(app, "/api/v1/policies/rules", body, token);

const denyGithub = {
  name: "Deny GitHub",
  action: "deny",
  mode: "enforce",
  enabled: true,
  conditions: [{ field: "action", operator: "is", value: "github" }],
};

describe("rules CRUD", () => {
  test("a fresh workspace has no rules", async () => {
    const { user } = await workspaceUser("empty-rules@example.com");
    const response = await getJson(app, "/api/v1/policies/rules", user.token);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.total).toBe(0);
  });

  test("create compiles the rule to Rego and assigns priority 1", async () => {
    const { user } = await workspaceUser("create-rule@example.com");

    const created = await createRule(user.token, denyGithub);
    expect(created.status).toBe(200);
    expect(created.body.message).toBe("Policy rule created");

    const rule = created.body.data;
    expect(rule.priority).toBe(1);
    expect(rule.enabled).toBe(true);
    expect(rule.mode).toBe("enforce");
    expect(rule.decided).toBe(0);
    expect(rule.medianReviewMs).toBe(0);
    expect(rule.rego).toContain("package runmesh.policy");
    expect(rule.rego).toContain('# 1 · Deny GitHub');
    expect(rule.rego).toContain('input.tool.name == "github"');
    expect(rule.rego).toContain('decision := {"decision": "deny"}');

    const numeric = await createRule(user.token, {
      name: "Spend cap",
      action: "escalate",
      mode: "enforce",
      enabled: true,
      conditions: [{ field: "amount", operator: ">", value: "500" }],
    });
    expect(numeric.body.data.rego).toContain("input.amount > 500");

    const listed = await getJson(app, "/api/v1/policies/rules", user.token);
    expect(listed.body.data.map((rule: { priority: number }) => rule.priority)).toEqual([1, 2]);
    expect(listed.body.meta.total).toBe(2);
  });

  test("validation rejects bad rules with the Python messages", async () => {
    const { user } = await workspaceUser("validate-rule@example.com");

    const badAction = await createRule(user.token, { name: "x", action: "maybe" });
    expect(badAction.status).toBe(400);
    expect(badAction.body.error.message).toBe("Action must be allow, escalate, consent, or deny");

    const badMode = await createRule(user.token, { name: "x", mode: "shadow" });
    expect(badMode.status).toBe(400);
    expect(badMode.body.error.message).toBe("Mode must be enforce or log-only");

    const badReversibility = await createRule(user.token, { name: "x", reversibility: "maybe" });
    expect(badReversibility.status).toBe(400);

    const badField = await createRule(user.token, {
      name: "x",
      conditions: [{ field: "repo", operator: "is", value: "a/b" }],
    });
    expect(badField.status).toBe(400);
    expect(badField.body.error.message).toBe(
      "Condition field must be one of: action, agent, scope, resource, user, amount, time",
    );

    const badOperator = await createRule(user.token, {
      name: "x",
      conditions: [{ field: "action", operator: "regex", value: "a" }],
    });
    expect(badOperator.status).toBe(400);
    expect(badOperator.body.error.message).toContain("Condition operator must be one of:");

    const emptyName = await createRule(user.token, { name: "   " });
    expect(emptyName.status).toBe(400);
    expect(emptyName.body.error.message).toBe("Rule name is required (1-80 characters)");

    const longDescription = await createRule(user.token, {
      name: "x",
      description: "d".repeat(501),
    });
    expect(longDescription.status).toBe(400);

    const missingName = await createRule(user.token, { action: "deny" });
    expect(missingName.status).toBe(422);
  });

  test("patch updates only the named fields; an empty patch is a no-op", async () => {
    const { user } = await workspaceUser("patch-rule@example.com");
    const created = await createRule(user.token, denyGithub);
    const ruleId = created.body.data.id as string;

    const patched = await fetch(`${app.base}/api/v1/policies/rules/${ruleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ description: "  tighter  " }),
    });
    const patchedBody = (await patched.json()) as { data: { description: string } };
    expect(patchedBody.data.description).toBe("tighter");

    const noop = await fetch(`${app.base}/api/v1/policies/rules/${ruleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({}),
    });
    const noopBody = (await noop.json()) as { message?: string };
    expect(noopBody.message).toBeUndefined();

    const missing = await fetch(`${app.base}/api/v1/policies/rules/pol_nope`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ name: "x" }),
    });
    expect(missing.status).toBe(404);
  });

  test("delete compacts the remaining priorities", async () => {
    const { user } = await workspaceUser("delete-rule@example.com");
    const one = await createRule(user.token, { name: "one", enabled: true });
    const two = await createRule(user.token, { name: "two", enabled: true });
    const three = await createRule(user.token, { name: "three", enabled: true });

    const removed = await fetch(
      `${app.base}/api/v1/policies/rules/${two.body.data.id as string}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${user.token}` } },
    );
    const removedBody = (await removed.json()) as { message: string };
    expect(removedBody.message).toBe("Policy rule deleted");

    const listed = await getJson(app, "/api/v1/policies/rules", user.token);
    expect(listed.body.data.map((rule: { name: string }) => rule.name)).toEqual(["one", "three"]);
    expect(listed.body.data.map((rule: { priority: number }) => rule.priority)).toEqual([1, 2]);
    expect(listed.body.data.map((rule: { id: string }) => rule.id)).toEqual([
      one.body.data.id,
      three.body.data.id,
    ]);
  });

  test("reorder rewrites priorities and rejects partial id sets", async () => {
    const { user } = await workspaceUser("reorder-rule@example.com");
    const one = await createRule(user.token, { name: "one" });
    const two = await createRule(user.token, { name: "two" });
    const three = await createRule(user.token, { name: "three" });

    const ids = [
      three.body.data.id as string,
      one.body.data.id as string,
      two.body.data.id as string,
    ];

    const reordered = await postJson(app, "/api/v1/policies/rules/reorder", { ids }, user.token);
    expect(reordered.status).toBe(200);
    expect(reordered.body.message).toBe("Policy rules reordered");
    expect(reordered.body.data.map((rule: { name: string }) => rule.name)).toEqual([
      "three",
      "one",
      "two",
    ]);

    const partial = await postJson(
      app,
      "/api/v1/policies/rules/reorder",
      { ids: [ids[0]] },
      user.token,
    );
    expect(partial.status).toBe(400);

    const duplicate = await postJson(
      app,
      "/api/v1/policies/rules/reorder",
      { ids: [ids[0], ids[0], ids[1]] },
      user.token,
    );
    expect(duplicate.status).toBe(400);
  });

  test("rules are scoped to the workspace", async () => {
    const alice = await workspaceUser("scope-alice@example.com");
    const bob = await workspaceUser("scope-bob@example.com");

    const aliceRule = await createRule(alice.user.token, denyGithub);

    const bobList = await getJson(app, "/api/v1/policies/rules", bob.user.token);
    expect(bobList.body.data).toEqual([]);

    const bobPatch = await fetch(
      `${app.base}/api/v1/policies/rules/${aliceRule.body.data.id as string}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bob.user.token}`,
        },
        body: JSON.stringify({ name: "hijack" }),
      },
    );
    expect(bobPatch.status).toBe(404);
  });
});

describe("dry-run evaluation", () => {
  test("an unmatched action falls to the default deny", async () => {
    const { user } = await workspaceUser("eval-empty@example.com");

    const response = await postJson(
      app,
      "/api/v1/policies/evaluate",
      { action: "github" },
      user.token,
    );
    expect(response.status).toBe(200);
    expect(response.body.data.decision).toBe("deny");
    expect(response.body.data.rule).toBeNull();
    expect(response.body.data.reason).toBe(
      "No rule matched. github falls to the default (deny).",
    );
    expect(response.body.data.steps).toEqual([]);
    expect(response.body.data.changeHint).toContain("Add a rule that covers this action");
  });

  test("first match wins and the trace shows the skipped rules", async () => {
    const { user } = await workspaceUser("eval-match@example.com");
    await createRule(user.token, {
      name: "Allow reads",
      action: "allow",
      mode: "enforce",
      enabled: true,
      conditions: [{ field: "action", operator: "is", value: "github" }],
    });
    await createRule(user.token, denyGithub);

    const response = await postJson(
      app,
      "/api/v1/policies/evaluate",
      { action: "github", agent: "deploy-bot" },
      user.token,
    );
    expect(response.body.data.decision).toBe("allow");
    expect(response.body.data.rule.name).toBe("Allow reads");
    expect(response.body.data.reason).toBe("Allow reads matched on action is github.");
    expect(response.body.data.steps.map((step: { status: string }) => step.status)).toEqual([
      "matched",
      "not-reached",
    ]);
    expect(response.body.data.changeHint).toBe(
      "Nothing needs to change. This runs without a human.",
    );
  });

  test("a disabled rule never decides", async () => {
    const { user } = await workspaceUser("eval-disabled@example.com");
    await createRule(user.token, { ...denyGithub, enabled: false });

    const response = await postJson(
      app,
      "/api/v1/policies/evaluate",
      { action: "github" },
      user.token,
    );
    expect(response.body.data.decision).toBe("deny");
    expect(response.body.data.rule).toBeNull();
    expect(response.body.data.steps[0].status).toBe("disabled");
  });
});

describe("oversight", () => {
  test("coverage gaps group defaulted decisions by action", async () => {
    const { user, workspaceId } = await workspaceUser("gaps@example.com");

    recordDecision(app.handle.db, {
      workspaceId,
      decision: "deny",
      mode: "none",
      enforced: true,
      defaultApplied: true,
      context: { action: "github", scope: "", resource: "" },
      agentLabel: "deploy-bot",
    });
    recordDecision(app.handle.db, {
      workspaceId,
      decision: "deny",
      mode: "none",
      enforced: true,
      defaultApplied: true,
      context: { action: "github", scope: "", resource: "" },
      agentLabel: "deploy-bot",
    });
    recordDecision(app.handle.db, {
      workspaceId,
      decision: "deny",
      mode: "none",
      enforced: true,
      defaultApplied: true,
      context: { action: "slack", scope: "", resource: "" },
      agentLabel: "chat-bot",
    });

    const response = await getJson(app, "/api/v1/policies/coverage-gaps", user.token);
    expect(response.body.data.total).toBe(3);
    expect(response.body.data.gaps[0]).toMatchObject({
      action: "github",
      blocked: 2,
      agents: ["deploy-bot"],
    });
    expect(response.body.data.gaps[1]).toMatchObject({ action: "slack", blocked: 1 });
    expect(response.body.data.gaps[0].lastSeen).not.toBe("");
  });

  test("the capability matrix projects rules over agents and known actions", async () => {
    const { user, workspaceId } = await workspaceUser("matrix@example.com");
    const now = new Date().toISOString();

    app.handle.db
      .insert(agents)
      .values({
        id: "agt_matrix",
        workspaceId,
        userId: user.id,
        name: "deploy-bot",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    app.handle.db
      .insert(agents)
      .values({
        id: "agt_archived",
        workspaceId,
        userId: user.id,
        name: "old-bot",
        status: "archived",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    app.handle.db
      .insert(tools)
      .values({
        id: "tool_1",
        workspaceId,
        name: "create-issue",
        action: "github.issue.create",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    await createRule(user.token, {
      name: "Deny Google",
      action: "deny",
      mode: "enforce",
      enabled: true,
      conditions: [{ field: "action", operator: "is", value: "google" }],
    });

    const response = await getJson(app, "/api/v1/policies/capability-matrix", user.token);
    expect(response.body.data.configured).toBe(true);
    expect(response.body.data.agents).toEqual([{ id: "agt_matrix", name: "deploy-bot" }]);
    expect(response.body.data.matrix.map((row: { action: string }) => row.action)).toEqual([
      "google",
      "slack",
      "meta",
      "intercom",
      "github.issue.create",
    ]);

    const googleRow = response.body.data.matrix.find(
      (row: { action: string }) => row.action === "google",
    );
    expect(googleRow.cells.agt_matrix).toEqual({
      decision: "deny",
      rule: "Deny Google",
      default: false,
    });

    const slackRow = response.body.data.matrix.find(
      (row: { action: string }) => row.action === "slack",
    );
    expect(slackRow.cells.agt_matrix).toEqual({
      decision: "deny",
      rule: null,
      default: true,
    });

    const toolRow = response.body.data.matrix.find(
      (row: { action: string }) => row.action === "github.issue.create",
    );
    expect(toolRow.cells.agt_matrix).toEqual({
      decision: "deny",
      rule: null,
      default: true,
    });
  });
});

describe("issuance enforcement", () => {
  test("with no enforcing rule policy is off and issuance proceeds", async () => {
    const { workspaceId } = await workspaceUser("enforce-off@example.com");

    const outcome = enforceGrantIssuance(app.handle.db, {
      workspaceId,
      provider: "github",
      scopes: ["repo"],
      userLabel: "user@example.com",
    });

    expect(outcome).toMatchObject({
      decision: "allow",
      rule: null,
      enforced: false,
      configured: false,
      defaultApplied: false,
      blocks: false,
      reason: "No enforcing rule configured; issuance proceeds.",
    });

    const rows = app.handle.db
      .select()
      .from(policyDecisions)
      .where(eq(policyDecisions.workspaceId, workspaceId))
      .all();
    expect(rows.length).toBe(1);
    expect(rows[0].enforced).toBe(0);
    expect(rows[0].mode).toBe("none");
    expect(rows[0].action).toBe("github");
    expect(rows[0].scope).toBe("repo");
    expect(rows[0].source).toBe("grant");
    expect(rows[0].enforcement).toBe("cooperative");
    expect(rows[0].reason).toBe("No enforcing rule configured; issuance proceeds.");
  });

  test("an enforced deny blocks and writes both the ledger and the audit trail", async () => {
    const { user, workspaceId } = await workspaceUser("enforce-deny@example.com");
    await createRule(user.token, denyGithub);

    const now = new Date().toISOString();
    app.handle.db
      .insert(agents)
      .values({
        id: "agt_1",
        workspaceId,
        userId: user.id,
        name: "deploy-bot",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    app.handle.db
      .insert(connectUsers)
      .values({
        id: "cusr_1",
        status: "active",
        primaryEmail: "user@example.com",
        primaryEmailVerified: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const outcome = enforceGrantIssuance(app.handle.db, {
      workspaceId,
      provider: "github",
      scopes: ["repo"],
      agentId: "agt_1",
      agentLabel: "deploy-bot",
      connectUserId: "cusr_1",
      userLabel: "user@example.com",
      runId: "run_1",
    });

    expect(outcome.decision).toBe("deny");
    expect(outcome.rule?.name).toBe("Deny GitHub");
    expect(outcome.enforced).toBe(true);
    expect(outcome.blocks).toBe(true);
    expect(outcome.reason).toBe("Deny GitHub denies this.");
    expect(outcome.ledgerOk).toBe(true);

    const decision = app.handle.db
      .select()
      .from(policyDecisions)
      .where(and(eq(policyDecisions.workspaceId, workspaceId), eq(policyDecisions.enforced, 1)))
      .get();
    expect(decision?.decision).toBe("deny");
    expect(decision?.mode).toBe("enforce");
    expect(decision?.ruleId).toBe(outcome.rule?.id ?? null);
    expect(decision?.agentLabel).toBe("deploy-bot");
    expect(decision?.userLabel).toBe("user@example.com");
    expect(decision?.connectUserId).toBe("cusr_1");
    expect(decision?.runId).toBe("run_1");

    const audit = app.handle.db
      .select()
      .from(connectAuditEvents)
      .where(eq(connectAuditEvents.workspaceId, workspaceId))
      .all()
      .find((row) => row.eventType === "policy.decision");
    expect(audit?.actorType).toBe("system");
    expect(audit?.result).toBe("denied");
    expect(audit?.resourceType).toBe("connect_policy");
    expect(audit?.denialReason).toBe("Deny GitHub denies this.");
    expect(JSON.parse(audit?.metadata ?? "{}").decision).toBe("deny");
  });

  test("a log-only rule is recorded as a shadow and does not decide", async () => {
    const { user, workspaceId } = await workspaceUser("enforce-shadow@example.com");
    await createRule(user.token, { ...denyGithub, name: "Watch GitHub", mode: "log-only" });

    const outcome = enforceGrantIssuance(app.handle.db, {
      workspaceId,
      provider: "github",
      scopes: ["repo"],
    });

    // No enforce rule exists, so policy is off — the shadow is still recorded.
    expect(outcome.decision).toBe("allow");
    expect(outcome.enforced).toBe(false);
    expect(outcome.configured).toBe(false);
    expect(outcome.blocks).toBe(false);

    const rows = app.handle.db
      .select()
      .from(policyDecisions)
      .where(eq(policyDecisions.workspaceId, workspaceId))
      .all();
    const shadow = rows.find((row) => row.mode === "log-only");
    expect(shadow?.enforced).toBe(0);
    expect(shadow?.decision).toBe("deny");
    expect(shadow?.reason).toBe("Watch GitHub would have denyed.");
  });

  test("scope-qualified rules fire alongside provider rules", async () => {
    const { user, workspaceId } = await workspaceUser("enforce-scope@example.com");
    await createRule(user.token, {
      name: "Block gmail send",
      action: "deny",
      mode: "enforce",
      enabled: true,
      conditions: [{ field: "action", operator: "is", value: "google.gmail.send" }],
    });

    const blocked = enforceGrantIssuance(app.handle.db, {
      workspaceId,
      provider: "google",
      scopes: ["gmail.send"],
    });
    expect(blocked.decision).toBe("deny");
    expect(blocked.blocks).toBe(true);
    expect(blocked.rule?.name).toBe("Block gmail send");

    const allowed = enforceGrantIssuance(app.handle.db, {
      workspaceId,
      provider: "google",
      scopes: ["gmail.readonly"],
    });
    // Configured, nothing matched -> default deny.
    expect(allowed.decision).toBe("deny");
    expect(allowed.defaultApplied).toBe(true);
    expect(allowed.rule).toBeNull();
    expect(allowed.reason).toBe("No enabled rule matched and policy is on; blocked by default.");
  });

  test("restrictive mode never auto-approves but still honours deny", async () => {
    const { user, workspaceId } = await workspaceUser("enforce-restrictive@example.com");
    await createRule(user.token, {
      name: "Allow GitHub",
      action: "allow",
      mode: "enforce",
      enabled: true,
      conditions: [{ field: "action", operator: "is", value: "github" }],
    });

    const allowed = enforceGrantIssuance(app.handle.db, {
      workspaceId,
      provider: "github",
      scopes: [],
      restrictive: true,
      source: "consent",
    });
    expect(allowed.decision).toBe("allow");
    expect(allowed.enforced).toBe(true);
    expect(allowed.blocks).toBe(false);

    await createRule(user.token, { ...denyGithub, name: "Deny Slack" , conditions: [
      { field: "action", operator: "is", value: "slack" },
    ] });

    const denied = enforceGrantIssuance(app.handle.db, {
      workspaceId,
      provider: "slack",
      scopes: [],
      restrictive: true,
      source: "consent",
    });
    expect(denied.decision).toBe("deny");
    expect(denied.blocks).toBe(true);
  });

  test("the call path decides on the registry-derived action override", async () => {
    const { user, workspaceId } = await workspaceUser("enforce-callpath@example.com");
    await createRule(user.token, {
      name: "Block issue creation",
      action: "deny",
      mode: "enforce",
      enabled: true,
      conditions: [
        { field: "action", operator: "is", value: "github.issue.create" },
      ],
    });

    const outcome = enforceGrantIssuance(app.handle.db, {
      workspaceId,
      provider: "github",
      scopes: ["repo"],
      actionOverride: "github.issue.create",
      source: "tool",
      grantId: "grant_1",
      enforcement: "inline",
    });

    expect(outcome.decision).toBe("deny");
    expect(outcome.blocks).toBe(true);
    expect(outcome.context.action).toBe("github.issue.create");

    const audit = app.handle.db
      .select()
      .from(connectAuditEvents)
      .where(eq(connectAuditEvents.workspaceId, workspaceId))
      .all()
      .find((row) => row.eventType === "policy.decision");
    expect(audit?.resourceType).toBe("connect_grant");
    expect(audit?.resourceId).toBe("grant_1");
  });
});
