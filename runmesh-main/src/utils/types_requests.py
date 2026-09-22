from pydantic import (
    BaseModel,
    Field,
)

from typing import (
    Any,
    Dict,
    List,
    Optional,
)


class TaskPublish(BaseModel):
    url: Optional[str] = None
    payload: dict = {}
    payload_template: Optional[str] = None
    url_template: Optional[str] = None
    type: str = "task"
    action_kind: str = "http"
    action_name: Optional[str] = None
    agent_id: Optional[str] = None
    agent_session_id: Optional[str] = None
    thread_id: Optional[str] = None
    tool_name: Optional[str] = None
    actor_user_id: Optional[str] = None
    approval_status: str = "not_required"
    approval_id: Optional[str] = None
    connect_app_id: Optional[str] = None
    connect_grant_id: Optional[str] = None
    connect_session_id: Optional[str] = None
    workspace_project_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    workflow_id: Optional[str] = None
    execution_type: str = "queue"
    scheduled_at: Optional[str] = None
    max_retries: int = 5
    idempotency_key: Optional[str] = None
    signing_secret: Optional[str] = None

class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    trigger_type: str = "manual"
    trigger_config: Optional[str] = None
    agent_id: Optional[str] = None
    thread_id: Optional[str] = None
    workspace_project_id: Optional[str] = None
    connect_app_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    tasks: List[TaskPublish] = []

class ScheduledTaskRequest(BaseModel):
    url: Optional[str] = None
    payload: dict = {}
    payload_template: Optional[str] = None
    url_template: Optional[str] = None
    type: str = "task"
    action_kind: str = "http"
    action_name: Optional[str] = None
    agent_id: Optional[str] = None
    agent_session_id: Optional[str] = None
    thread_id: Optional[str] = None
    tool_name: Optional[str] = None
    actor_user_id: Optional[str] = None
    approval_status: str = "not_required"
    approval_id: Optional[str] = None
    connect_app_id: Optional[str] = None
    connect_grant_id: Optional[str] = None
    connect_session_id: Optional[str] = None
    workspace_project_id: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    workflow_id: Optional[str] = None
    scheduled_at: str
    max_retries: int = 5
    idempotency_key: Optional[str] = None
    signing_secret: Optional[str] = None

class TaskRescheduleRequest(BaseModel):
    scheduled_at: str  # ISO datetime string


class WorkspaceInviteRequest(BaseModel):
    email: str
    role: str = "member"


class WorkspaceOnboardRequest(BaseModel):
    name: str
    type: str = "personal"
    slug: Optional[str] = None
    avatar_url: Optional[str] = None
    plan: str = "free"
    seats: int = 1
    metadata: Dict[str, Any] = Field(default_factory=dict)
    invites: List[WorkspaceInviteRequest] = Field(default_factory=list)

class ApiKeyCreateRequest(BaseModel):
    name: str
    permissions: List[str] = ["read"]
    expires_at: Optional[str] = None  # ISO datetime string

class AgentCreateRequest(BaseModel):
    name: str
    description: str = ""
    parent_agent_id: Optional[str] = None
    project_id: Optional[str] = None
    environment: Optional[str] = None  # dev | staging | prod (validated in service; DB CHECK would 500)
    public_key: Optional[str] = None   # agent Ed25519 key; private half never leaves the agent

class WebhookCreateRequest(BaseModel):
    name: str
    url: str
    events: str = "task.completed,task.failed"

class PolicyConditionInput(BaseModel):
    field: str = "action"
    operator: str = "is"
    value: str = ""

class PolicyRuleCreateRequest(BaseModel):
    name: str
    description: str = ""
    conditions: List[PolicyConditionInput] = Field(default_factory=list)
    action: str = "escalate"  # allow | escalate | consent | deny
    scope: str = "all scopes"
    mode: str = "log-only"  # enforce | log-only
    caps: Dict[str, Any] = Field(default_factory=dict)
    reversibility: str = "reversible"  # reversible | undoable | irreversible
    enabled: bool = False

class PolicyRuleUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    conditions: Optional[List[PolicyConditionInput]] = None
    action: Optional[str] = None
    scope: Optional[str] = None
    mode: Optional[str] = None
    caps: Optional[Dict[str, Any]] = None
    reversibility: Optional[str] = None

class PolicyReorderRequest(BaseModel):
    ids: List[str] = Field(default_factory=list)

class PolicyEvaluateRequest(BaseModel):
    agent: str = ""
    action: str = ""
    resource: str = ""
    user: str = ""
    amount: str = "0"

class AgentResolveRequest(BaseModel):
    external_key: Optional[str] = None
    fingerprint: Optional[str] = None
    name: Optional[str] = None
    framework: Optional[str] = None
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    tools: Optional[List[Dict[str, Any]]] = None

class RunStartRequest(BaseModel):
    agent_id: str
    parent_run_id: Optional[str] = None
    input: Optional[str] = None
    thread_id: Optional[str] = None
    connect_user_id: Optional[str] = None

class RunFinishRequest(BaseModel):
    status: str = "completed"  # completed | failed
    usage: Optional[Dict[str, Any]] = None

class IngestEventInput(BaseModel):
    run_id: str
    kind: str = "log"  # tool.call | tool.result | model.request | model.response | policy.decision | error | log
    name: str = ""
    args: Optional[Dict[str, Any]] = None
    result: Optional[Dict[str, Any]] = None
    duration_ms: Optional[int] = None

class IngestRequest(BaseModel):
    events: List[IngestEventInput] = Field(default_factory=list)

class WorkflowGraphUpdate(BaseModel):
    nodes: List[dict]
    edges: List[dict]

class WorkflowUpdate(BaseModel):
    description: Optional[str] = None
    name: Optional[str] = None
    trigger_type: Optional[str] = None
    trigger_config: Optional[str] = None

class GrantCreateRequest(BaseModel):
    connection_id: str
    agent_id: Optional[str] = None
    scopes: List[str] = Field(default_factory=list)
    resource_filters: Optional[Dict[str, Any]] = None
    max_uses: Optional[int] = None
    valid_until: Optional[str] = None  # ISO datetime string
    environment: Optional[str] = None  # dev | staging | prod (validated in service; DB CHECK would 500)
    approval_status: str = "pending_approval"  # pending_approval | approved

class GrantRevokeRequest(BaseModel):
    reason: Optional[str] = None


class ToolInvokeRequest(BaseModel):
    run_id: str
    args: Dict[str, Any] = Field(default_factory=dict)
    idempotency_key: Optional[str] = None
    connect_user_id: Optional[str] = None


class ToolForwardRequest(BaseModel):
    run_id: str
    method: str = "GET"
    path: str
    headers: Optional[Dict[str, str]] = None
    body: Optional[Any] = None
    query: Optional[Dict[str, Any]] = None
    idempotency_key: Optional[str] = None
    connect_user_id: Optional[str] = None


