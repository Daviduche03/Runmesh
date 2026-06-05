import datetime
import time
from pydantic import BaseModel, Field
from enum import Enum
import uuid

class TaskStatus(Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    QUEUED = "queued"
    RUNNING = "running"
    CANCELLED = "cancelled"
    
class WorkflowStatus(Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    QUEUED = "queued"
    RUNNING = "running"
    CANCELLED = "cancelled"

VALID_TRANSITIONS = {
    TaskStatus.PENDING: [TaskStatus.QUEUED, TaskStatus.FAILED],
    TaskStatus.QUEUED: [TaskStatus.RUNNING, TaskStatus.FAILED],
    TaskStatus.RUNNING: [TaskStatus.COMPLETED, TaskStatus.FAILED],
    TaskStatus.COMPLETED: [],
    TaskStatus.FAILED: [TaskStatus.QUEUED],
    TaskStatus.CANCELLED: [],
}

class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str

    class Config:
        from_attributes = True

class TaskCreate(BaseModel):
    type: str
    payload: dict
    scheduled_at: datetime.datetime = Field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc))
    execution_type: str = "queue"
    url: str
    workflow_id: uuid.UUID | None = None

class TaskResponse(BaseModel):
    id: uuid.UUID
    type: str
    payload: dict
    status: TaskStatus
    retries: int
    max_retries: int
    scheduled_at: datetime.datetime
    idempotency_key: str

    class Config:
        from_attributes = True


WORKFLOWS_SCHEMA = """
CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    trigger_config TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

WORKFLOW_RUNS_SCHEMA = """
CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    triggered_by TEXT NOT NULL DEFAULT 'manual',
    current_step INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    user_id TEXT NOT NULL
);
"""


