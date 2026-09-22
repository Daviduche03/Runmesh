from pydantic import (
    BaseModel,
    Field,
    field_validator,
    model_validator,
)

from typing import (
    Any,
    Dict,
    List,
    Optional,
    Self,
)

from utils.types_enums import (
    ConnectAppStatus,
    ConnectAuditActorType,
    ConnectConnectionStatus,
    ConnectGrantStatus,
    ConnectIdentityProvider,
    ConnectOtpStatus,
    ConnectSessionMode,
    ConnectSessionStatus,
    ConnectUserStatus,
)
from utils.types_helpers import (
    bool_from_sqlite,
    parse_json_dict,
    parse_json_list,
    sql_nullable,
)


class ConnectOtpVerifyRequest(BaseModel):
    challenge_id: str
    code: str


class ConnectOtpResendRequest(BaseModel):
    challenge_id: str


class ConnectSessionCreateRequest(BaseModel):
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
    code: Optional[str] = None
    grant_id: Optional[str] = None
    task_id: Optional[str] = None
    workflow_run_id: Optional[str] = None
    workspace_project_id: Optional[str] = None
    agent_id: Optional[str] = None

    @field_validator("code", "grant_id", "task_id", "workflow_run_id", "workspace_project_id", "agent_id", mode="before")
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


class ConnectGrantApprovalRequest(BaseModel):
    """Request to approve a pending grant."""
    reason: Optional[str] = None


class ConnectGrantDenialRequest(BaseModel):
    """Request to deny a grant."""
    reason: str


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
    workspace_id: Optional[str] = None

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
    workspace_id: Optional[str] = None


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
    workspace_id: Optional[str] = None

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
    workspace_id: Optional[str] = None


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
    workspace_id: Optional[str] = None


class ConnectGrantRow(ConnectRowBase):
    id: str
    connect_app_id: Optional[str] = None
    connect_user_id: str
    connection_id: str
    scopes: List[str] = Field(default_factory=list)
    status: ConnectGrantStatus
    granted_at: str
    revoked_at: Optional[str] = None
    created_at: str
    updated_at: str
    created_by_task_id: Optional[str] = None
    created_by_workflow_run_id: Optional[str] = None
    agent_id: Optional[str] = None
    approval_status: str = "pending_approval"
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    resource_filters: Optional[Dict[str, Any]] = None
    max_uses: Optional[int] = None
    use_count: int = 0
    project_id: Optional[str] = None
    environment: Optional[str] = None
    workspace_id: Optional[str] = None

    @field_validator("scopes", mode="before")
    @classmethod
    def _scopes(cls, value: Any) -> List[str]:
        return parse_json_list(value)

    @field_validator("resource_filters", mode="before")
    @classmethod
    def _resource_filters(cls, value: Any) -> Optional[Dict[str, Any]]:
        return parse_json_dict(value) if value else None

    @field_validator("max_uses", mode="before")
    @classmethod
    def _max_uses(cls, value: Any) -> Optional[int]:
        if value is None:
            return None
        v = int(value)
        if v <= 0:
            raise ValueError("max_uses must be positive")
        return v

    @field_validator("status", mode="before")
    @classmethod
    def _status(cls, value: Any) -> ConnectGrantStatus:
        return ConnectGrantStatus(str(value))


class ConnectGrantCreate(BaseModel):
    connect_app_id: Optional[str] = None
    connect_user_id: str
    connection_id: str
    scopes: List[str] = Field(default_factory=list)
    status: ConnectGrantStatus = ConnectGrantStatus.ACTIVE
    granted_at: Optional[str] = None
    created_by_task_id: Optional[str] = None
    created_by_workflow_run_id: Optional[str] = None
    agent_id: Optional[str] = None
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    resource_filters: Optional[Dict[str, Any]] = None
    max_uses: Optional[int] = None
    project_id: Optional[str] = None
    environment: Optional[str] = None
    workspace_id: Optional[str] = None
    approval_status: str = "pending_approval"

    @field_validator("resource_filters", mode="before")
    @classmethod
    def _rf(cls, value: Any) -> Optional[Dict[str, Any]]:
        return parse_json_dict(value) if value else None

    @field_validator("max_uses", mode="before")
    @classmethod
    def _mu(cls, value: Any) -> Optional[int]:
        if value is None:
            return None
        v = int(value)
        if v <= 0:
            raise ValueError("max_uses must be positive")
        return v

    @field_validator("environment", mode="before")
    @classmethod
    def _env(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        v = str(value).strip().lower()
        if v not in ("dev", "staging", "prod"):
            raise ValueError("environment must be dev, staging, or prod")
        return v


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
    workspace_id: Optional[str] = None

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
    workspace_id: Optional[str] = None


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
    workspace_id: Optional[str] = None
    agent_id: Optional[str] = None
    task_id: Optional[str] = None
    workflow_run_id: Optional[str] = None
    approval_required: bool = False
    denial_reason: Optional[str] = None
    token_issued_at: Optional[str] = None
    token_expires_at: Optional[str] = None
    result: str = "success"
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    request_id: Optional[str] = None
    workspace_id: Optional[str] = None

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
    agent_id: Optional[str] = None
    task_id: Optional[str] = None
    workflow_run_id: Optional[str] = None
    approval_required: bool = False
    denial_reason: Optional[str] = None
    token_issued_at: Optional[str] = None
    token_expires_at: Optional[str] = None
    result: str = "success"
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    request_id: Optional[str] = None
    workspace_id: Optional[str] = None
