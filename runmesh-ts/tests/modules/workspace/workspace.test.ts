import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTestUser,
  deleteJson,
  getJson,
  postJson,
  startTestApp,
} from "../../helpers/test-app.js";
import type { TestApp } from "../../helpers/test-app.js";

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp("workspace");
});

afterAll(async () => {
  await app.close();
});

const onboard = (body: Record<string, unknown>, token: string) =>
  postJson(app, "/api/v1/workspaces/onboard", body, token);

describe("workspaces", () => {
  test("listing reflects memberships; onboarding provisions the personal workspace", async () => {
    const user = await createTestUser(app, "personal@example.com");

    const empty = await getJson(app, "/api/v1/workspaces", user.token);
    expect(empty.body.data).toEqual([]);

    const created = await onboard({ name: "Personal" }, user.token);
    const listed = await getJson(app, "/api/v1/workspaces", user.token);
    expect(listed.body.data.length).toBe(1);
    expect(listed.body.data[0].id).toBe(created.body.data.id);
    expect(listed.body.data[0].role).toBe("owner");
    expect(listed.body.meta.total).toBe(1);
  });

  test("ensurePersonalWorkspace provisions once and then reuses it", async () => {
    const user = await createTestUser(app, "ensure@example.com");
    const { ensurePersonalWorkspace } = await import(
      "../../../src/modules/workspace/tenancy.js"
    );

    const first = ensurePersonalWorkspace(app.handle.db, user.id);
    const second = ensurePersonalWorkspace(app.handle.db, user.id);
    expect(second).toBe(first);

    const listed = await getJson(app, "/api/v1/workspaces", user.token);
    expect(listed.body.data.length).toBe(1);
    expect(listed.body.data[0].name).toBe("Personal");
  });

  test("onboarding a personal workspace is idempotent", async () => {
    const user = await createTestUser(app, "onboard-personal@example.com");

    const first = await onboard({ name: "Mine" }, user.token);
    expect(first.status).toBe(200);
    expect(first.body.data.created).toBe(true);
    expect(first.body.message).toBe("Workspace created");

    const second = await onboard({ name: "Mine again" }, user.token);
    expect(second.body.data.created).toBe(false);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.message).toBe("Personal workspace already exists");
  });

  test("a work workspace is created with invites that can be accepted", async () => {
    const owner = await createTestUser(app, "owner@example.com");
    const invitee = await createTestUser(app, "invitee@example.com");

    const created = await onboard(
      {
        name: "Acme",
        type: "work",
        plan: "pro",
        seats: 5,
        invites: [{ email: "invitee@example.com", role: "member" }],
      },
      owner.token,
    );

    expect(created.status).toBe(200);
    expect(created.body.data.type).toBe("work");
    expect(created.body.data.seats).toBe(5);
    expect(created.body.data.invites.created.length).toBe(1);

    const token = created.body.data.invites.created[0].token as string;
    const accepted = await postJson(
      app,
      `/api/v1/workspaces/invites/${token}/accept`,
      {},
      invitee.token,
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.role).toBe("member");

    const listed = await getJson(app, "/api/v1/workspaces", invitee.token);
    expect(listed.body.data.map((w: { name: string }) => w.name)).toEqual(["Acme"]);

    const reused = await postJson(
      app,
      `/api/v1/workspaces/invites/${token}/accept`,
      {},
      invitee.token,
    );
    expect(reused.status).toBe(404);
  });

  test("an invite cannot be accepted by a different email", async () => {
    const owner = await createTestUser(app, "owner2@example.com");
    const stranger = await createTestUser(app, "stranger@example.com");

    const created = await onboard(
      {
        name: "Beta",
        type: "work",
        invites: [{ email: "someone-else@example.com", role: "admin" }],
      },
      owner.token,
    );
    const token = created.body.data.invites.created[0].token as string;

    const response = await postJson(
      app,
      `/api/v1/workspaces/invites/${token}/accept`,
      {},
      stranger.token,
    );
    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe("Invite was sent to a different email");
  });

  test("invalid invites are reported, not fatal", async () => {
    const owner = await createTestUser(app, "owner3@example.com");
    const created = await onboard(
      {
        name: "Gamma",
        type: "work",
        invites: [
          { email: "not-an-email", role: "member" },
          { email: "ok@example.com", role: "member" },
          { email: "ok@example.com", role: "member" },
          { email: "bad-role@example.com", role: "superuser" },
        ],
      },
      owner.token,
    );

    const skipped = created.body.data.invites.skipped as Array<{ reason: string }>;
    expect(skipped.map((entry) => entry.reason)).toEqual([
      "invalid email",
      "duplicate in request",
      "role must be member or admin",
    ]);
    expect(created.body.data.invites.created.length).toBe(1);
  });

  test("a taken slug is a 409", async () => {
    const first = await createTestUser(app, "slug1@example.com");
    const second = await createTestUser(app, "slug2@example.com");

    const created = await onboard({ name: "One", type: "work", slug: "acme" }, first.token);
    expect(created.status).toBe(200);

    const conflict = await onboard({ name: "Two", type: "work", slug: "acme" }, second.token);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.message).toBe("Slug is already taken");
  });

  test("workspace validation matches the Python rules", async () => {
    const user = await createTestUser(app, "validate@example.com");

    expect((await onboard({ name: "" }, user.token)).status).toBe(400);
    expect((await onboard({ name: "X", type: "company" }, user.token)).status).toBe(400);
    expect((await onboard({ name: "X", type: "personal", seats: 2 }, user.token)).status).toBe(400);
    expect((await onboard({ name: "X", plan: "gold" }, user.token)).status).toBe(400);
    expect(
      (await onboard({ name: "X", invites: [{ email: "a@example.com" }] }, user.token)).status,
    ).toBe(400);
  });

  test("membership gates hide other workspaces behind a 404", async () => {
    const owner = await createTestUser(app, "owner4@example.com");
    const outsider = await createTestUser(app, "outsider@example.com");
    const created = await onboard({ name: "Private", type: "work" }, owner.token);

    const { requireMembership, resolveWorkspaceId } = await import(
      "../../../src/modules/workspace/tenancy.js"
    );
    const db = app.handle.db;

    expect(() =>
      resolveWorkspaceId(db, outsider.id, created.body.data.id as string),
    ).toThrow(/Workspace not found/);

    const membership = requireMembership(db, owner.id, created.body.data.id as string);
    expect(membership.role).toBe("owner");
  });

  test("projects are linked, listed and unlinked per user", async () => {
    const user = await createTestUser(app, "projects@example.com");

    const empty = await getJson(app, "/api/workspace/projects", user.token);
    expect(empty.body.data).toEqual([]);

    const linked = await postJson(
      app,
      "/api/workspace/projects",
      { prefix: "org/repo", bucket: "runmesh-bucket" },
      user.token,
    );
    expect(linked.status).toBe(200);
    expect(linked.body.data.prefix).toBe("org/repo");

    const listed = await getJson(app, "/api/workspace/projects", user.token);
    expect(listed.body.data.length).toBe(1);
    expect(listed.body.meta.total).toBe(1);
    expect(listed.body.data[0].local_path).toBeNull();

    const missingPrefix = await postJson(
      app,
      "/api/workspace/projects",
      { bucket: "b" },
      user.token,
    );
    expect(missingPrefix.status).toBe(400);

    const removed = await deleteJson(
      app,
      `/api/workspace/projects/${linked.body.data.id}`,
      user.token,
    );
    expect(removed.body.message).toBe("Project unlinked");

    const after = await getJson(app, "/api/workspace/projects", user.token);
    expect(after.body.data).toEqual([]);
  });
});
