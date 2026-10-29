/**
 * String-union enums, ported from legacy/runmesh-main/src/utils/types_enums.py.
 * Python used `str`-valued Enum members (`ConnectGrantStatus.ACTIVE == "active"`), which maps
 * naturally onto a const object plus a derived union type — call sites keep the same shape.
 */

export const ConnectUserStatus = { ACTIVE: "active", SUSPENDED: "suspended" } as const;
export type ConnectUserStatus = (typeof ConnectUserStatus)[keyof typeof ConnectUserStatus];

export const ConnectAppStatus = { ACTIVE: "active", DISABLED: "disabled" } as const;
export type ConnectAppStatus = (typeof ConnectAppStatus)[keyof typeof ConnectAppStatus];

export const ConnectConnectionStatus = { ACTIVE: "active", REVOKED: "revoked", EXPIRED: "expired" } as const;
export type ConnectConnectionStatus =
  (typeof ConnectConnectionStatus)[keyof typeof ConnectConnectionStatus];

export const ConnectGrantStatus = { ACTIVE: "active", REVOKED: "revoked" } as const;
export type ConnectGrantStatus = (typeof ConnectGrantStatus)[keyof typeof ConnectGrantStatus];

export const ConnectSessionStatus = {
  PENDING: "pending",
  COMPLETED: "completed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
} as const;
export type ConnectSessionStatus = (typeof ConnectSessionStatus)[keyof typeof ConnectSessionStatus];

export const ConnectSessionMode = {
  AUTHENTICATE: "authenticate",
  CONNECT: "connect",
  GRANT: "grant",
} as const;
export type ConnectSessionMode = (typeof ConnectSessionMode)[keyof typeof ConnectSessionMode];

export const ConnectAuditEventType = {
  APP_CREATED: "connect.app.created",
  SESSION_CREATED: "connect.session.created",
  CONNECTION_CREATED: "connect.connection.created",
  GRANT_CREATED: "connect.grant.created",
  GRANT_APPROVED: "connect.grant.approved",
  GRANT_DENIED: "connect.grant.denied",
  GRANT_REVOKED: "connect.grant.revoked",
  TOKEN_EXCHANGED: "connect.token.exchanged",
  POLICY_UPDATED: "policy.updated",
  POLICY_DECISION: "policy.decision",
  RUN_STARTED: "agent.run.started",
  RUN_FINISHED: "agent.run.finished",
} as const;
export type ConnectAuditEventType = (typeof ConnectAuditEventType)[keyof typeof ConnectAuditEventType];

export const ConnectResourceType = {
  CONNECT_APP: "connect_app",
  CONNECT_SESSION: "connect_session",
  CONNECT_CONNECTION: "connect_connection",
  CONNECT_GRANT: "connect_grant",
  CONNECT_TOKEN: "connect_token",
  CONNECT_POLICY: "connect_policy",
  AGENT_RUN: "agent_run",
} as const;
export type ConnectResourceType = (typeof ConnectResourceType)[keyof typeof ConnectResourceType];

export const ConnectIdentityProvider = { GOOGLE: "google" } as const;
export type ConnectIdentityProvider =
  (typeof ConnectIdentityProvider)[keyof typeof ConnectIdentityProvider];

export const ConnectAuditActorType = {
  CONNECT_USER: "connect_user",
  DEVELOPER: "developer",
  SYSTEM: "system",
  APP: "app",
} as const;
export type ConnectAuditActorType = (typeof ConnectAuditActorType)[keyof typeof ConnectAuditActorType];

export const ConnectOtpStatus = {
  PENDING: "pending",
  VERIFIED: "verified",
  EXPIRED: "expired",
  FAILED: "failed",
} as const;
export type ConnectOtpStatus = (typeof ConnectOtpStatus)[keyof typeof ConnectOtpStatus];

export const TaskStatus = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
  QUEUED: "queued",
  RUNNING: "running",
  CANCELLED: "cancelled",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const WorkflowStatus = { ...TaskStatus } as const;
export type WorkflowStatus = (typeof WorkflowStatus)[keyof typeof WorkflowStatus];
