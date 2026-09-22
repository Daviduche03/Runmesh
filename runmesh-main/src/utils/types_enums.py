from enum import Enum


class ConnectUserStatus(str, Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"


class ConnectAppStatus(str, Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class ConnectConnectionStatus(str, Enum):
    ACTIVE = "active"
    REVOKED = "revoked"
    EXPIRED = "expired"


class ConnectGrantStatus(str, Enum):
    ACTIVE = "active"
    REVOKED = "revoked"


class ConnectSessionStatus(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class ConnectSessionMode(str, Enum):
    AUTHENTICATE = "authenticate"
    CONNECT = "connect"
    GRANT = "grant"


class ConnectAuditEventType(str, Enum):
    APP_CREATED = "connect.app.created"
    SESSION_CREATED = "connect.session.created"
    CONNECTION_CREATED = "connect.connection.created"
    GRANT_CREATED = "connect.grant.created"
    GRANT_APPROVED = "connect.grant.approved"
    GRANT_DENIED = "connect.grant.denied"
    GRANT_REVOKED = "connect.grant.revoked"
    TOKEN_EXCHANGED = "connect.token.exchanged"
    POLICY_UPDATED = "policy.updated"
    POLICY_DECISION = "policy.decision"
    RUN_STARTED = "agent.run.started"
    RUN_FINISHED = "agent.run.finished"


class ConnectResourceType(str, Enum):
    CONNECT_APP = "connect_app"
    CONNECT_SESSION = "connect_session"
    CONNECT_CONNECTION = "connect_connection"
    CONNECT_GRANT = "connect_grant"
    CONNECT_TOKEN = "connect_token"
    CONNECT_POLICY = "connect_policy"
    AGENT_RUN = "agent_run"


class ConnectIdentityProvider(str, Enum):
    GOOGLE = "google"


class ConnectAuditActorType(str, Enum):
    CONNECT_USER = "connect_user"
    DEVELOPER = "developer"
    SYSTEM = "system"
    APP = "app"


class ConnectOtpStatus(str, Enum):
    PENDING = "pending"
    VERIFIED = "verified"
    EXPIRED = "expired"
    FAILED = "failed"


