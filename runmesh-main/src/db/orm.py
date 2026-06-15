from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
import uuid

class Model:
    def __init__(self, db):
        self.db = db
    
    async def insert(self, table: str, data: Dict[str, Any]) -> str:
        """Insert a record and return the ID"""
        columns = list(data.keys())
        placeholders = ["?" for _ in columns]
        values = list(data.values())
        
        query = f"""
            INSERT INTO {table} ({', '.join(columns)})
            VALUES ({', '.join(placeholders)})
        """
        
        await self.db.prepare(query).bind(*values).run()
        return data.get('id') or values[0]  # Return ID if provided
    
    async def find_one(self, table: str, where: str, *params) -> Optional[Dict[str, Any]]:
        """Find one record"""
        query = f"SELECT * FROM {table} WHERE {where} LIMIT 1"
        result = await self.db.prepare(query).bind(*params).first()
        
        if not result:
            return None
        
        # Handle pyodide.ffi.JsProxy objects
        if hasattr(result, 'as_py'):
            return result.as_py()
        elif hasattr(result, 'to_py'):
            return result.to_py()
        elif hasattr(result, '__dict__'):
            return dict(result)
        else:
            return result
    
    async def find_many(self, table: str, where: str = "1=1", *params, limit: int = 0) -> List[Dict[str, Any]]:
        query = f"SELECT * FROM {table} WHERE {where}"
        if limit:
            query += f" LIMIT {limit}"
        result = await self.db.prepare(query).bind(*params).all()
        if not result:
            return []
        rows = result.results if hasattr(result, 'results') else []
        out = []
        for r in rows:
            if hasattr(r, 'as_py'):
                out.append(r.as_py())
            elif hasattr(r, 'to_py'):
                out.append(r.to_py())
            elif isinstance(r, dict):
                out.append(r)
            else:
                out.append(dict(r))
        return out
    
    async def update(self, table: str, where: str, data: Dict[str, Any], *where_params) -> int:
        """Update records and return affected count"""
        set_clause = ", ".join([f"{k} = ?" for k in data.keys()])
        values = list(data.values()) + list(where_params)
        
        query = f"UPDATE {table} SET {set_clause} WHERE {where}"
        result = await self.db.prepare(query).bind(*values).run()
        return result.meta.changes or 0
    
    async def delete(self, table: str, where: str, *params) -> int:
        """Delete records and return affected count"""
        query = f"DELETE FROM {table} WHERE {where}"
        result = await self.db.prepare(query).bind(*params).run()
        return result.meta.changes or 0

class TaskModel(Model):
    def __init__(self, db):
        super().__init__(db)
    
    async def create(self, task_data: Dict[str, Any]) -> str:
        """Create a new task"""
        if not task_data.get('id'):
            
            task_data['id'] = str(uuid.uuid4())
        
        if not task_data.get('created_at'):
            task_data['created_at'] = datetime.now(timezone.utc).isoformat()
        
        if not task_data.get('updated_at'):
            task_data['updated_at'] = datetime.now(timezone.utc).isoformat()
        
        if not task_data.get('idempotency_key'):
            task_data['idempotency_key'] = str(uuid.uuid4())
        
        return await self.insert('tasks', task_data)
    
    async def find_by_id(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Find task by ID"""
        return await self.find_one('tasks', 'id = ?', task_id)

    async def find_by_idempotency_key(self, user_id: str, idempotency_key: str) -> Optional[Dict[str, Any]]:
        return await self.find_one('tasks', 'user_id = ? AND idempotency_key = ?', user_id, idempotency_key)

    async def list_by_workflow_id(self, workflow_id: str) -> List[Dict[str, Any]]:
        return await self.find_many('tasks', 'workflow_id = ? ORDER BY step_order ASC, created_at ASC', workflow_id)

    async def delete_by_workflow_id(self, workflow_id: str) -> int:
        return await super().delete('tasks', 'workflow_id = ?', workflow_id)

    async def delete_task(self, task_id: str) -> int:
        return await super().delete('tasks', 'id = ?', task_id)

    async def update_status(self, task_id: str, status: str) -> int:
        """Update task status"""
        return await self.update(
            'tasks', 
            'id = ?', 
            {'status': status, 'updated_at': datetime.now(timezone.utc).isoformat()},
            task_id
        )
    
    async def increment_retries(self, task_id: str, status: str) -> int:
        """Increment retries and update status"""
        query = """
            UPDATE tasks 
            SET status = ?, retries = retries + 1, updated_at = ? 
            WHERE id = ?
        """
        result = await self.db.prepare(query).bind(
            status, 
            datetime.now(timezone.utc).isoformat(), 
            task_id
        ).run()
        return result.meta.changes or 0

    async def reset_for_workflow_run(self, task_id: str) -> int:
        now = datetime.now(timezone.utc).isoformat()
        query = """
            UPDATE tasks
            SET status = 'pending', retries = 0, updated_at = ?,
                response_body = NULL, response_status = NULL
            WHERE id = ?
        """
        result = await self.db.prepare(query).bind(now, task_id).run()
        return result.meta.changes or 0

    async def complete_execution(
        self,
        task_id: str,
        status: str,
        response_body: str = "",
        response_status: int = 0,
    ) -> int:
        now = datetime.now(timezone.utc).isoformat()
        query = """
            UPDATE tasks
            SET status = ?, updated_at = ?, response_body = ?, response_status = ?,
                retries = retries + CASE WHEN ? = 'failed' THEN 1 ELSE 0 END
            WHERE id = ?
        """
        result = await self.db.prepare(query).bind(
            status,
            now,
            response_body,
            response_status,
            status,
            task_id,
        ).run()
        return result.meta.changes or 0

class WorkflowModel(Model):
    def __init__(self, db):
        super().__init__(db)
    
    async def create(self, workflow_data: Dict[str, Any]) -> str:
        """Create a new workflow"""
        if not workflow_data.get('id'):
            workflow_data['id'] = str(uuid.uuid4())
        
        if not workflow_data.get('created_at'):
            workflow_data['created_at'] = datetime.now(timezone.utc).isoformat()
        
        if not workflow_data.get('updated_at'):
            workflow_data['updated_at'] = datetime.now(timezone.utc).isoformat()
        
        return await self.insert('workflows', workflow_data)
    
    async def list(self, user_id: str) -> List[Dict[str, Any]]:
        """List workflows for a user"""
        return await self.find_many('workflows', 'user_id = ?', user_id)

    async def find_by_id(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        return await self.find_one('workflows', 'id = ?', workflow_id)

    async def list_by_trigger_type(self, trigger_type: str) -> List[Dict[str, Any]]:
        return await self.find_many('workflows', 'trigger_type = ?', trigger_type)

    async def delete_workflow(self, workflow_id: str) -> int:
        return await super().delete('workflows', 'id = ?', workflow_id)

class WorkflowRunModel(Model):
    def __init__(self, db):
        super().__init__(db)

    async def create(self, run_data: Dict[str, Any]) -> str:
        if not run_data.get("id"):
            run_data["id"] = str(uuid.uuid4())
        return await self.insert("workflow_runs", run_data)

    async def find_by_id(self, run_id: str) -> Optional[Dict[str, Any]]:
        return await self.find_one("workflow_runs", "id = ?", run_id)

    async def list_by_workflow_id(self, workflow_id: str) -> List[Dict[str, Any]]:
        return await self.find_many(
            "workflow_runs",
            "workflow_id = ? ORDER BY started_at DESC",
            workflow_id,
        )

    async def find_active_for_workflow(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        return await self.find_one(
            "workflow_runs",
            "workflow_id = ? AND status = 'running'",
            workflow_id,
        )

    async def list_running(self) -> List[Dict[str, Any]]:
        return await self.find_many("workflow_runs", "status = 'running'")

    async def delete_by_workflow_id(self, workflow_id: str) -> int:
        return await super().delete("workflow_runs", "workflow_id = ?", workflow_id)

class UserModel(Model):
    def __init__(self, db):
        super().__init__(db)
    
    async def create(self, user_data: Dict[str, Any]) -> str:
        """Create a new user"""
        if not user_data.get('id'):
            user_data['id'] = str(uuid.uuid4())
        
        if not user_data.get('created_at'):
            user_data['created_at'] = datetime.now(timezone.utc).isoformat()
        
        if not user_data.get('updated_at'):
            user_data['updated_at'] = datetime.now(timezone.utc).isoformat()
        
        return await self.insert('users', user_data)
    
    async def find_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Find user by email"""
        return await self.find_one('users', 'email = ?', email.lower())
    
    async def find_by_github_id(self, github_id: str) -> Optional[Dict[str, Any]]:
        """Find user by GitHub ID"""
        return await self.find_one('users', 'github_id = ?', github_id)
    
    async def find_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Find user by ID"""
        return await self.find_one('users', 'id = ?', user_id)

class ApiKeyModel(Model):
    def __init__(self, db):
        super().__init__(db)
    
    async def create(self, api_key_data: Dict[str, Any]) -> str:
        """Create a new API key"""
        """Create a new API key"""
        if not api_key_data.get('id'):
            api_key_data['id'] = str(uuid.uuid4())
        
        if not api_key_data.get('created_at'):
            api_key_data['created_at'] = datetime.now(timezone.utc).isoformat()
        
        if not api_key_data.get('updated_at'):
            api_key_data['updated_at'] = datetime.now(timezone.utc).isoformat()
        
        return await self.insert('api_keys', api_key_data)
    
    async def find_by_key_hash(self, key_hash: str) -> Optional[Dict[str, Any]]:
        """Find API key by hash"""
        return await self.find_one('api_keys', 'key_hash = ? AND is_active = 1', key_hash)
    
    async def find_by_user_id(self, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Find API keys by user ID"""
        return await self.find_many('api_keys', 'user_id = ? AND is_active = 1', user_id, limit=limit)
    
    async def update_last_used(self, key_id: str) -> int:
        """Update last used timestamp"""
        return await self.update(
            'api_keys', 
            'id = ?', 
            {'last_used_at': datetime.now(timezone.utc).isoformat()},
            key_id
        )
    
    async def deactivate(self, key_id: str) -> int:
        """Deactivate an API key"""
        return await self.update(
            'api_keys', 
            'id = ?', 
            {'is_active': 0, 'updated_at': datetime.now(timezone.utc).isoformat()},
            key_id
        )


class WebhookModel(Model):
    def __init__(self, db):
        super().__init__(db)

    async def create(self, data: Dict[str, Any]) -> str:
        if not data.get('id'):
            data['id'] = str(uuid.uuid4())
        if not data.get('created_at'):
            data['created_at'] = datetime.now(timezone.utc).isoformat()
        if not data.get('updated_at'):
            data['updated_at'] = datetime.now(timezone.utc).isoformat()
        return await self.insert('webhooks', data)

    async def find_by_user_id(self, user_id: str) -> list:
        return await self.find_many('webhooks', 'user_id = ? ORDER BY created_at DESC', user_id)

    async def find_active_by_user_id(self, user_id: str) -> list:
        return await self.find_many(
            'webhooks',
            "user_id = ? AND status = 'active' ORDER BY created_at DESC",
            user_id,
        )

    async def find_by_id(self, webhook_id: str):
        return await self.find_one('webhooks', 'id = ?', webhook_id)

    async def delete(self, webhook_id: str) -> int:
        return await super().delete('webhooks', 'id = ?', webhook_id)


class WebhookDeadLetterModel(Model):
    def __init__(self, db):
        super().__init__(db)

    async def create(self, data: Dict[str, Any]) -> str:
        if not data.get("id"):
            data["id"] = str(uuid.uuid4())
        if not data.get("created_at"):
            data["created_at"] = datetime.now(timezone.utc).isoformat()
        return await self.insert("webhook_dead_letters", data)

    async def find_by_user_id(self, user_id: str, include_replayed: bool = False) -> list:
        if include_replayed:
            return await self.find_many(
                "webhook_dead_letters",
                "user_id = ? ORDER BY failed_at DESC",
                user_id,
            )
        return await self.find_many(
            "webhook_dead_letters",
            "user_id = ? AND replayed_at IS NULL ORDER BY failed_at DESC",
            user_id,
        )

    async def find_by_id(self, dead_letter_id: str):
        return await self.find_one("webhook_dead_letters", "id = ?", dead_letter_id)

    async def mark_replayed(self, dead_letter_id: str) -> int:
        now = datetime.now(timezone.utc).isoformat()
        return await self.update(
            "webhook_dead_letters",
            "id = ?",
            {"replayed_at": now},
            dead_letter_id,
        )

    async def delete(self, dead_letter_id: str) -> int:
        return await super().delete("webhook_dead_letters", "id = ?", dead_letter_id)
