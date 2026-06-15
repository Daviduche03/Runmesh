import json
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Self

from pydantic import BaseModel, Field, field_validator, model_validator

class TaskPublish(BaseModel):
    url: Optional[str] = None
    payload: dict = {}
    payload_template: Optional[str] = None
    url_template: Optional[str] = None
    type: str = "task"
    workflow_id: Optional[str] = None
    execution_type: str = "queue"
    scheduled_at: Optional[str] = None
    max_retries: int = 5
    idempotency_key: Optional[str] = None

class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    trigger_type: str = "manual"
    trigger_config: Optional[str] = None
    tasks: List[TaskPublish] = []

class ScheduledTaskRequest(BaseModel):
    url: Optional[str] = None
    payload: dict = {}
    payload_template: Optional[str] = None
    url_template: Optional[str] = None
    type: str = "task"
    workflow_id: Optional[str] = None
    scheduled_at: str
    max_retries: int = 5
    idempotency_key: Optional[str] = None

class TaskRescheduleRequest(BaseModel):
    scheduled_at: str  # ISO datetime string

class ApiKeyCreateRequest(BaseModel):
    name: str
    permissions: List[str] = ["read"]
    expires_at: Optional[str] = None  # ISO datetime string

class WebhookCreateRequest(BaseModel):
    name: str
    url: str
    events: str = "task.completed,task.failed"

class WorkflowGraphUpdate(BaseModel):
    nodes: List[dict]
    edges: List[dict]

class WorkflowUpdate(BaseModel):
    description: str


class ConnectAppCreateRequest(BaseModel):
    name: str
    slug: str
    redirect_uris: List[str] = Field(default_factory=list)
    allowed_providers: List[str] = Field(default_factory=list)


class ConnectOtpVerifyRequest(BaseModel):
    challenge_id: str
    code: str


class ConnectOtpResendRequest(BaseModel):
    challenge_id: str


class ConnectSessionCreateRequest(BaseModel):
    app_id: str
    external_user_id: str
    email: Optional[str] = None
    connect_user_id: Optional[str] = None
    mode: str = "authenticate"
    redirect_uri: str
    provider: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)


class ConnectConsentRequest(BaseModel):
    state: str
    action: str


class ConnectTokenRequest(BaseModel):
    app_id: str
    code: Optional[str] = None
    grant_id: Optional[str] = None

    @field_validator("code", "grant_id", mode="before")
    @classmethod
    def _strip_optional(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @model_validator(mode="after")
    def _require_code_or_grant(self) -> Self:
        if bool(self.code) == bool(self.grant_id):
            raise ValueError("provide exactly one of code or grant_id")
        return self


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_json_list(value: Any, default: Optional[List[str]] = None) -> List[str]:
    if value is None:
        return list(default or [])
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str):
        if not value.strip():
            return list(default or [])
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return list(default or [])
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    return list(default or [])


def parse_json_dict(value: Any, default: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if value is None:
        return dict(default or {})
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        if not value.strip():
            return dict(default or {})
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return dict(default or {})
        if isinstance(parsed, dict):
            return parsed
    return dict(default or {})


def bool_from_sqlite(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return int(value) == 1


def sql_nullable(value: Any) -> Any:
    if value is None:
        return None
    if type(value).__name__ == "JsNull":
        return None
    return value


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
    GRANT_APPROVED = "connect.grant.approved"
    GRANT_DENIED = "connect.grant.denied"


class ConnectResourceType(str, Enum):
    CONNECT_APP = "connect_app"
    CONNECT_SESSION = "connect_session"
    CONNECT_CONNECTION = "connect_connection"
    CONNECT_GRANT = "connect_grant"


class ConnectIdentityProvider(str, Enum):
    GOOGLE = "google"


class ConnectAuditActorType(str, Enum):
    CONNECT_USER = "connect_user"
    DEVELOPER = "developer"
    SYSTEM = "system"
    APP = "app"


class ConnectRowBase(BaseModel):
    @classmethod
    def from_row(cls, row: Optional[Dict[str, Any]]) -> Optional[Self]:
        if not row:
            return None
        normalized = {key: sql_nullable(value) for key, value in row.items()}
        return cls.model_validate(normalized)


class ConnectUserRow(ConnectRowBase):
    id: str
    status: ConnectUserStatus
    primary_email: Optional[str] = None
    primary_email_verified: bool = False
    created_at: str
    updated_at: str

    @field_validator("status", mode="before")
    @classmethod
    def _status(cls, value: Any) -> ConnectUserStatus:
        return ConnectUserStatus(str(value))

    @field_validator("primary_email_verified", mode="before")
    @classmethod
    def _primary_email_verified(cls, value: Any) -> bool:
        return bool(value)


class ConnectUserCreate(BaseModel):
    status: ConnectUserStatus = ConnectUserStatus.ACTIVE
    primary_email: Optional[str] = None
    primary_email_verified: bool = False


class ConnectOtpStatus(str, Enum):
    PENDING = "pending"
    VERIFIED = "verified"
    EXPIRED = "expired"
    FAILED = "failed"


class ConnectAccountSessionCreate(BaseModel):
    connect_user_id: str
    token_hash: str
    expires_at: str


class ConnectAccountSessionRow(ConnectRowBase):
    id: str
    connect_user_id: str
    token_hash: str
    expires_at: str
    created_at: str


class ConnectOtpChallengeCreate(BaseModel):
    connect_app_id: str
    external_user_id: str
    email: str
    code_hash: str
    connect_session_id: Optional[str] = None
    connect_user_id: Optional[str] = None
    status: ConnectOtpStatus = ConnectOtpStatus.PENDING
    expires_at: str


class ConnectOtpChallengeRow(ConnectRowBase):
    id: str
    connect_app_id: str
    external_user_id: str
    connect_session_id: Optional[str] = None
    email: str
    code_hash: str
    connect_user_id: Optional[str] = None
    status: ConnectOtpStatus
    expires_at: str
    attempts: int = 0
    verified_at: Optional[str] = None
    created_at: str

    @field_validator("status", mode="before")
    @classmethod
    def _status(cls, value: Any) -> ConnectOtpStatus:
        return ConnectOtpStatus(str(value))

    @field_validator("attempts", mode="before")
    @classmethod
    def _attempts(cls, value: Any) -> int:
        return int(value or 0)


class ConnectIdentityRow(ConnectRowBase):
    id: str
    connect_user_id: str
    provider: ConnectIdentityProvider
    provider_subject: str
    email: Optional[str] = None
    email_verified: bool = False
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: str
    updated_at: str

    @field_validator("provider", mode="before")
    @classmethod
    def _provider(cls, value: Any) -> ConnectIdentityProvider:
        return ConnectIdentityProvider(str(value))

    @field_validator("email_verified", mode="before")
    @classmethod
    def _email_verified(cls, value: Any) -> bool:
        return bool_from_sqlite(value)


class ConnectIdentityCreate(BaseModel):
    connect_user_id: str
    provider: ConnectIdentityProvider
    provider_subject: str
    email: Optional[str] = None
    email_verified: bool = False
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None


class ConnectAppRow(ConnectRowBase):
    id: str
    developer_user_id: str
    name: str
    slug: str
    client_secret_hash: str
    redirect_uris: List[str] = Field(default_factory=list)
    allowed_providers: List[str] = Field(default_factory=list)
    status: ConnectAppStatus
    created_at: str
    updated_at: str

    @field_validator("redirect_uris", "allowed_providers", mode="before")
    @classmethod
    def _json_lists(cls, value: Any) -> List[str]:
        return parse_json_list(value)

    @field_validator("status", mode="before")
    @classmethod
    def _status(cls, value: Any) -> ConnectAppStatus:
        return ConnectAppStatus(str(value))


class ConnectAppCreate(BaseModel):
    developer_user_id: str
    name: str
    slug: str
    client_secret_hash: str
    redirect_uris: List[str] = Field(default_factory=list)
    allowed_providers: List[str] = Field(default_factory=list)
    status: ConnectAppStatus = ConnectAppStatus.ACTIVE


class ConnectAppUserRow(ConnectRowBase):
    id: str
    connect_app_id: str
    external_user_id: str
    connect_user_id: str
    created_at: str
    updated_at: str


class ConnectAppUserCreate(BaseModel):
    connect_app_id: str
    external_user_id: str
    connect_user_id: str


class ConnectConnectionRow(ConnectRowBase):
    id: str
    connect_user_id: str
    provider: str
    status: ConnectConnectionStatus
    scopes: List[str] = Field(default_factory=list)
    access_token_enc: Optional[str] = None
    refresh_token_enc: Optional[str] = None
    token_expires_at: Optional[str] = None
    provider_account_id: Optional[str] = None
    provider_account_label: Optional[str] = None
    identity_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str
    revoked_at: Optional[str] = None

    @field_validator("scopes", mode="before")
    @classmethod
    def _scopes(cls, value: Any) -> List[str]:
        return parse_json_list(value)

    @field_validator("metadata", mode="before")
    @classmethod
    def _metadata(cls, value: Any) -> Dict[str, Any]:
        return parse_json_dict(value)

    @field_validator("status", mode="before")
    @classmethod
    def _status(cls, value: Any) -> ConnectConnectionStatus:
        return ConnectConnectionStatus(str(value))


class ConnectConnectionCreate(BaseModel):
    connect_user_id: str
    provider: str
    status: ConnectConnectionStatus = ConnectConnectionStatus.ACTIVE
    scopes: List[str] = Field(default_factory=list)
    access_token_enc: Optional[str] = None
    refresh_token_enc: Optional[str] = None
    token_expires_at: Optional[str] = None
    provider_account_id: Optional[str] = None
    provider_account_label: Optional[str] = None
    identity_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ConnectConnectionUpdate(BaseModel):
    status: Optional[ConnectConnectionStatus] = None
    scopes: Optional[List[str]] = None
    access_token_enc: Optional[str] = None
    refresh_token_enc: Optional[str] = None
    token_expires_at: Optional[str] = None
    provider_account_id: Optional[str] = None
    provider_account_label: Optional[str] = None
    identity_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    revoked_at: Optional[str] = None


class ConnectGrantRow(ConnectRowBase):
    id: str
    connect_app_id: str
    connect_user_id: str
    connection_id: str
    scopes: List[str] = Field(default_factory=list)
    status: ConnectGrantStatus
    granted_at: str
    revoked_at: Optional[str] = None
    created_at: str
    updated_at: str

    @field_validator("scopes", mode="before")
    @classmethod
    def _scopes(cls, value: Any) -> List[str]:
        return parse_json_list(value)

    @field_validator("status", mode="before")
    @classmethod
    def _status(cls, value: Any) -> ConnectGrantStatus:
        return ConnectGrantStatus(str(value))


class ConnectGrantCreate(BaseModel):
    connect_app_id: str
    connect_user_id: str
    connection_id: str
    scopes: List[str] = Field(default_factory=list)
    status: ConnectGrantStatus = ConnectGrantStatus.ACTIVE
    granted_at: Optional[str] = None


class ConnectSessionRow(ConnectRowBase):
    id: str
    connect_app_id: str
    external_user_id: Optional[str] = None
    mode: ConnectSessionMode
    provider: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)
    redirect_uri: str
    state: str
    connect_user_id: Optional[str] = None
    status: ConnectSessionStatus
    expires_at: str
    completed_at: Optional[str] = None
    created_at: str

    @field_validator("scopes", mode="before")
    @classmethod
    def _scopes(cls, value: Any) -> List[str]:
        return parse_json_list(value)

    @field_validator("mode", mode="before")
    @classmethod
    def _mode(cls, value: Any) -> ConnectSessionMode:
        return ConnectSessionMode(str(value))

    @field_validator("status", mode="before")
    @classmethod
    def _status(cls, value: Any) -> ConnectSessionStatus:
        return ConnectSessionStatus(str(value))


class ConnectSessionCreate(BaseModel):
    connect_app_id: str
    external_user_id: Optional[str] = None
    mode: ConnectSessionMode
    provider: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)
    redirect_uri: str
    state: str
    connect_user_id: Optional[str] = None
    status: ConnectSessionStatus = ConnectSessionStatus.PENDING
    expires_at: str


class ConnectSessionUpdate(BaseModel):
    connect_user_id: Optional[str] = None
    status: Optional[ConnectSessionStatus] = None
    completed_at: Optional[str] = None


class ConnectAuditEventRow(ConnectRowBase):
    id: str
    connect_user_id: Optional[str] = None
    connect_app_id: Optional[str] = None
    event_type: str
    actor_type: ConnectAuditActorType
    actor_id: Optional[str] = None
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    created_at: str

    @field_validator("metadata", mode="before")
    @classmethod
    def _metadata(cls, value: Any) -> Dict[str, Any]:
        return parse_json_dict(value)

    @field_validator("actor_type", mode="before")
    @classmethod
    def _actor_type(cls, value: Any) -> ConnectAuditActorType:
        return ConnectAuditActorType(str(value))


class ConnectAuditEventCreate(BaseModel):
    connect_user_id: Optional[str] = None
    connect_app_id: Optional[str] = None
    event_type: str
    actor_type: ConnectAuditActorType
    actor_id: Optional[str] = None
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

