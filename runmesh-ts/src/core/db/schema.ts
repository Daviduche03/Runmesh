/**
 * TypeScript type layer for the database.
 * schema.sql + the numbered files in ../migrations are the authoritative source.
 * Adding a column means writing a migration FIRST, then mirroring it here.
 * Constraints (CHECK / FOREIGN KEY / INDEX) are owned by the migrations and
 * are intentionally not declared here.
 */
import { sqliteTable, text, integer, real, blob, primaryKey } from "drizzle-orm/sqlite-core";

export const agentEvents = sqliteTable("agent_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  runId: text("run_id").notNull(),
  seq: integer("seq").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull().default(""),
  args: text("args").notNull().default("{}"),
  result: text("result").notNull().default("{}"),
  truncated: integer("truncated").notNull().default(0),
  durationMs: integer("duration_ms"),
  createdAt: text("created_at").notNull(),
  connectUserId: text("connect_user_id"),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  agentId: text("agent_id").notNull(),
  parentRunId: text("parent_run_id"),
  status: text("status").notNull().default("running"),
  input: text("input"),
  usage: text("usage").notNull().default("{}"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  threadId: text("thread_id"),
  connectUserId: text("connect_user_id"),
  agentVersionId: text("agent_version_id"),
  mode: text("mode").notNull().default("live"),
  replayOfRunId: text("replay_of_run_id"),
  triggerId: text("trigger_id"),
});

export const agentSessions = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  agentId: text("agent_id"),
  threadId: text("thread_id"),
  name: text("name"),
  status: text("status").notNull().default("active"),
  workflowId: text("workflow_id"),
  connectAppId: text("connect_app_id"),
  workspaceProjectId: text("workspace_project_id"),
  metadata: text("metadata").notNull().default("{}"),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agentVersions = sqliteTable("agent_versions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  agentId: text("agent_id").notNull(),
  version: integer("version").notNull(),
  framework: text("framework"),
  model: text("model"),
  systemPrompt: text("system_prompt"),
  tools: text("tools").notNull().default("[]"),
  fingerprint: text("fingerprint"),
  createdAt: text("created_at").notNull(),
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id"),
  userId: text("user_id").notNull(),
  name: text("name").notNull().default(""),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("active"),
  parentAgentId: text("parent_agent_id"),
  projectId: text("project_id"),
  environment: text("environment"),
  publicKey: text("public_key"),
  keyFingerprint: text("key_fingerprint"),
  keyRotatedAt: text("key_rotated_at"),
  suspendedAt: text("suspended_at"),
  suspendedReason: text("suspended_reason"),
  suspendedByUserId: text("suspended_by_user_id"),
  lastSeenAt: text("last_seen_at"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  framework: text("framework"),
  externalKey: text("external_key"),
  fingerprint: text("fingerprint"),
  model: text("model"),
  systemPrompt: text("system_prompt"),
  tools: text("tools").notNull().default("[]"),
  version: integer("version").notNull().default(1),
  currentVersionId: text("current_version_id"),
  endpointUrl: text("endpoint_url"),
  endpointSecretEnc: text("endpoint_secret_enc"),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  keyHash: text("key_hash").notNull(),
  name: text("name").notNull(),
  userId: text("user_id").notNull(),
  permissions: text("permissions").notNull().default("read"),
  isActive: integer("is_active").notNull().default(1),
  lastUsedAt: text("last_used_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  expiresAt: text("expires_at"),
  workspaceId: text("workspace_id"),
});

export const cliAuthCodes = sqliteTable("cli_auth_codes", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  deviceCode: text("device_code").notNull(),
  userCode: text("user_code").notNull(),
  status: text("status").notNull().default("pending"),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  confirmedAt: text("confirmed_at"),
});

export const connectAccountSessions = sqliteTable("connect_account_sessions", {
  id: text("id").primaryKey(),
  connectUserId: text("connect_user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const connectAppUsers = sqliteTable("connect_app_users", {
  id: text("id").primaryKey(),
  connectAppId: text("connect_app_id").notNull(),
  externalUserId: text("external_user_id").notNull(),
  connectUserId: text("connect_user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const connectApps = sqliteTable("connect_apps", {
  id: text("id").primaryKey(),
  developerUserId: text("developer_user_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  clientSecretHash: text("client_secret_hash").notNull(),
  redirectUris: text("redirect_uris").notNull().default("[]"),
  allowedProviders: text("allowed_providers").notNull().default("[]"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  workspaceId: text("workspace_id"),
});

export const connectAuditEvents = sqliteTable("connect_audit_events", {
  id: text("id").primaryKey(),
  connectUserId: text("connect_user_id"),
  connectAppId: text("connect_app_id"),
  eventType: text("event_type").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  agentId: text("agent_id"),
  taskId: text("task_id"),
  workflowRunId: text("workflow_run_id"),
  approvalRequired: integer("approval_required").default(0),
  denialReason: text("denial_reason"),
  tokenIssuedAt: text("token_issued_at"),
  tokenExpiresAt: text("token_expires_at"),
  result: text("result").default("success"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  requestId: text("request_id"),
  workspaceId: text("workspace_id"),
});

export const connectConnections = sqliteTable("connect_connections", {
  id: text("id").primaryKey(),
  connectUserId: text("connect_user_id").notNull(),
  provider: text("provider").notNull(),
  status: text("status").notNull().default("active"),
  scopes: text("scopes").notNull().default("[]"),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: text("token_expires_at"),
  providerAccountId: text("provider_account_id"),
  providerAccountLabel: text("provider_account_label"),
  identityId: text("identity_id"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  revokedAt: text("revoked_at"),
  workspaceId: text("workspace_id"),
});

export const connectGrants = sqliteTable("connect_grants", {
  id: text("id").primaryKey(),
  connectAppId: text("connect_app_id"),
  connectUserId: text("connect_user_id").notNull(),
  connectionId: text("connection_id").notNull(),
  scopes: text("scopes").notNull().default("[]"),
  status: text("status").notNull().default("active"),
  grantedAt: text("granted_at").notNull(),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  createdByTaskId: text("created_by_task_id"),
  createdByWorkflowRunId: text("created_by_workflow_run_id"),
  agentId: text("agent_id"),
  approvalStatus: text("approval_status").notNull().default("pending_approval"),
  validFrom: text("valid_from"),
  validUntil: text("valid_until"),
  resourceFilters: text("resource_filters"),
  maxUses: integer("max_uses"),
  useCount: integer("use_count").notNull().default(0),
  projectId: text("project_id"),
  environment: text("environment"),
  workspaceId: text("workspace_id"),
});

export const connectIdentities = sqliteTable("connect_identities", {
  id: text("id").primaryKey(),
  connectUserId: text("connect_user_id").notNull(),
  provider: text("provider").notNull(),
  providerSubject: text("provider_subject").notNull(),
  email: text("email"),
  emailVerified: integer("email_verified").notNull().default(0),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const connectOtpChallenges = sqliteTable("connect_otp_challenges", {
  id: text("id").primaryKey(),
  connectAppId: text("connect_app_id").notNull(),
  externalUserId: text("external_user_id").notNull(),
  connectSessionId: text("connect_session_id"),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  connectUserId: text("connect_user_id"),
  status: text("status").notNull().default("pending"),
  expiresAt: text("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  verifiedAt: text("verified_at"),
  createdAt: text("created_at").notNull(),
});

export const connectSessions = sqliteTable("connect_sessions", {
  id: text("id").primaryKey(),
  connectAppId: text("connect_app_id").notNull(),
  externalUserId: text("external_user_id"),
  mode: text("mode").notNull(),
  provider: text("provider"),
  scopes: text("scopes").notNull().default("[]"),
  redirectUri: text("redirect_uri").notNull(),
  state: text("state").notNull(),
  connectUserId: text("connect_user_id"),
  status: text("status").notNull().default("pending"),
  expiresAt: text("expires_at").notNull(),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  email: text("email"),
  workspaceId: text("workspace_id"),
});

export const connectUsers = sqliteTable("connect_users", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  primaryEmail: text("primary_email"),
  primaryEmailVerified: integer("primary_email_verified").notNull().default(0),
});

export const idempotencyKeys = sqliteTable("idempotency_keys", {
  workspaceId: text("workspace_id").notNull(),
  key: text("key").notNull(),
  status: integer("status").notNull(),
  response: text("response").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.workspaceId, table.key] }),
}));

export const policyDecisions = sqliteTable("policy_decisions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  ruleId: text("rule_id"),
  decision: text("decision").notNull(),
  mode: text("mode").notNull().default("none"),
  enforced: integer("enforced").notNull().default(0),
  defaultApplied: integer("default_applied").notNull().default(0),
  action: text("action").notNull().default(""),
  scope: text("scope").notNull().default(""),
  resource: text("resource").notNull().default(""),
  agentId: text("agent_id"),
  agentLabel: text("agent_label").notNull().default(""),
  connectUserId: text("connect_user_id"),
  userLabel: text("user_label").notNull().default(""),
  source: text("source").notNull().default("grant"),
  grantId: text("grant_id"),
  reason: text("reason").notNull().default(""),
  createdAt: text("created_at").notNull(),
  enforcement: text("enforcement").notNull().default("cooperative"),
  runId: text("run_id"),
});

export const policyRules = sqliteTable("policy_rules", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  priority: integer("priority").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  enabled: integer("enabled").notNull().default(1),
  conditions: text("conditions").notNull().default("[]"),
  action: text("action").notNull().default("escalate"),
  scope: text("scope").notNull().default("all scopes"),
  mode: text("mode").notNull().default("log-only"),
  caps: text("caps").notNull().default("{}"),
  reversibility: text("reversibility").notNull().default("reversible"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: text("window_start").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  payload: text("payload").notNull(),
  url: text("url").notNull(),
  status: text("status").notNull(),
  retries: integer("retries").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(5),
  scheduledAt: text("scheduled_at").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  executionType: text("execution_type").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  userId: text("user_id").notNull(),
  workflowId: text("workflow_id"),
  stepOrder: integer("step_order").default(0),
  payloadTemplate: text("payload_template"),
  urlTemplate: text("url_template"),
  responseBody: text("response_body"),
  responseStatus: integer("response_status"),
  actionKind: text("action_kind").notNull().default("http"),
  actionName: text("action_name"),
  agentId: text("agent_id"),
  agentSessionId: text("agent_session_id"),
  threadId: text("thread_id"),
  toolName: text("tool_name"),
  actorUserId: text("actor_user_id"),
  approvalStatus: text("approval_status").notNull().default("not_required"),
  approvalId: text("approval_id"),
  connectAppId: text("connect_app_id"),
  connectGrantId: text("connect_grant_id"),
  connectSessionId: text("connect_session_id"),
  workspaceProjectId: text("workspace_project_id"),
  metadata: text("metadata").notNull().default("{}"),
  signingSecret: text("signing_secret"),
  workspaceId: text("workspace_id"),
});

export const tools = sqliteTable("tools", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  agentId: text("agent_id"),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("local"),
  provider: text("provider"),
  action: text("action").notNull().default(""),
  method: text("method").notNull().default("POST"),
  url: text("url"),
  authScheme: text("auth_scheme").notNull().default("none"),
  authHeader: text("auth_header").notNull().default("Authorization"),
  authFormat: text("auth_format").notNull().default("Bearer {token}"),
  resourceParam: text("resource_param"),
  schemaHash: text("schema_hash").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  baseUrl: text("base_url"),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  password: text("password").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  githubId: text("github_id"),
  avatarUrl: text("avatar_url"),
});

export const webhookDeadLetters = sqliteTable("webhook_dead_letters", {
  id: text("id").primaryKey(),
  webhookId: text("webhook_id").notNull(),
  userId: text("user_id").notNull(),
  event: text("event").notNull(),
  eventId: text("event_id").notNull(),
  body: text("body").notNull(),
  lastStatusCode: integer("last_status_code"),
  lastError: text("last_error"),
  attempts: integer("attempts").notNull(),
  failedAt: text("failed_at").notNull(),
  replayedAt: text("replayed_at"),
  createdAt: text("created_at").notNull(),
  workspaceId: text("workspace_id"),
});

export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  events: text("events").notNull().default("task.completed"),
  status: text("status").notNull().default("active"),
  secret: text("secret").notNull(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  workspaceId: text("workspace_id"),
});

export const workflowRuns = sqliteTable("workflow_runs", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id").notNull(),
  status: text("status").notNull().default("running"),
  triggeredBy: text("triggered_by").notNull().default("manual"),
  currentStep: integer("current_step").notNull().default(0),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  userId: text("user_id").notNull(),
  agentSessionId: text("agent_session_id"),
  threadId: text("thread_id"),
  metadata: text("metadata").notNull().default("{}"),
});

export const workflows = sqliteTable("workflows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  triggerType: text("trigger_type").notNull().default("manual"),
  triggerConfig: text("trigger_config"),
  status: text("status").notNull().default("draft"),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  graph: text("graph"),
  agentId: text("agent_id"),
  threadId: text("thread_id"),
  workspaceProjectId: text("workspace_project_id"),
  connectAppId: text("connect_app_id"),
  metadata: text("metadata").notNull().default("{}"),
  workspaceId: text("workspace_id"),
});

export const workspaceInvites = sqliteTable("workspace_invites", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  status: text("status").notNull().default("pending"),
  tokenHash: text("token_hash").notNull(),
  invitedByUserId: text("invited_by_user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaceMembers = sqliteTable("workspace_members", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull().default("member"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaceProjects = sqliteTable("workspace_projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  prefix: text("prefix").notNull(),
  bucket: text("bucket").notNull(),
  localPath: text("local_path"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  ownerUserId: text("owner_user_id").notNull(),
  status: text("status").notNull().default("active"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  type: text("type").notNull().default("personal"),
  slug: text("slug"),
  avatarUrl: text("avatar_url"),
  plan: text("plan").notNull().default("free"),
  seats: integer("seats").notNull().default(1),
});

// Added by migration 0044, which lands after the schema.sql snapshot — keep the mirror honest.
export const queueMessages = sqliteTable("queue_messages", {
  id: text("id").primaryKey(),
  queue: text("queue").notNull(),
  body: text("body").notNull(),
  availableAt: text("available_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

// Added by migration 0043 (also after the snapshot).
export const triggers = sqliteTable("triggers", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  agentId: text("agent_id").notNull(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  enabled: integer("enabled").notNull().default(1),
  config: text("config").notNull().default("{}"),
  lastFiredAt: text("last_fired_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
