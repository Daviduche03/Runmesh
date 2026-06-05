from typing import Optional, List
from pydantic import BaseModel

class TaskPublish(BaseModel):
    url: str
    payload: dict = {}
    type: str = "task"
    workflow_id: Optional[str] = None
    execution_type: str = "queue"
    scheduled_at: Optional[str] = None

class WorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    trigger_type: str = "manual"
    trigger_config: Optional[str] = None
    tasks: List[TaskPublish] = []

class ScheduledTaskRequest(BaseModel):
    url: str
    payload: dict = {}
    type: str = "task"
    workflow_id: Optional[str] = None
    scheduled_at: str  # ISO datetime string
    max_retries: int = 5

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

