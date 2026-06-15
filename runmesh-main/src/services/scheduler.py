import uuid
import json
from datetime import datetime, timezone
from typing import List, Dict, Any
from db.orm import TaskModel

class TaskScheduler:
    """Service for managing scheduled task execution"""
    
    def __init__(self, db, queue):
        self.db = db
        self.queue = queue
        self.task_model = TaskModel(db)
    
    async def get_due_tasks(self) -> List[Dict[str, Any]]:
        """
        Get all tasks that are scheduled to run now or in the past
        
        Returns:
            List of tasks that are ready for execution
        """
        current_time = datetime.now(timezone.utc).isoformat()
        
        # Find tasks that are scheduled and ready to run
        query = """
            SELECT * FROM tasks 
            WHERE status = 'queued' 
            AND scheduled_at <= ? 
            AND execution_type = 'scheduled'
            ORDER BY scheduled_at ASC
        """
        
        result = await self.db.prepare(query).bind(current_time).all()
        
        if result and hasattr(result, 'results'):
            return [task.as_py() if hasattr(task, 'as_py') else task for task in result.results]
        elif result:
            return [result]
        else:
            return []
    
    async def enqueue_due_tasks(self) -> int:
        """
        Enqueue all tasks that are due for execution
        
        Returns:
            Number of tasks enqueued
        """
        due_tasks = await self.get_due_tasks()
        enqueued_count = 0
        
        for task in due_tasks:
            try:
                # Send task to execution queue
                await self.queue.send({"task_id": task["id"]})
                
                # Update task status to indicate it's been queued for execution
                await self.task_model.update_status(task["id"], "dispatched")
                enqueued_count += 1
                
            except Exception as e:
                print(f"Failed to enqueue task {task['id']}: {e}")
                # Keep task as 'queued' so it can be retried
        
        return enqueued_count
    
    async def schedule_task(
        self, 
        task_data: Dict[str, Any], 
        scheduled_at: datetime
    ) -> str:
        """
        Create a new scheduled task
        
        Args:
            task_data: Task configuration
            scheduled_at: When to execute the task
            
        Returns:
            Task ID
        """
        task_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        payload = task_data.get("payload", "{}")
        if not isinstance(payload, str):
            payload = json.dumps(payload)

        full_task_data = {
            "id": task_id,
            "type": task_data.get("type", "task"),
            "payload": payload,
            "url": task_data.get("url", ""),
            "status": "queued",
            "retries": 0,
            "max_retries": task_data.get("max_retries", 5),
            "scheduled_at": scheduled_at.isoformat(),
            "idempotency_key": str(uuid.uuid4()),
            "execution_type": "scheduled",
            "created_at": now,
            "updated_at": now,
            "user_id": task_data["user_id"],
        }
        workflow_id = task_data.get("workflow_id")
        if workflow_id:
            full_task_data["workflow_id"] = workflow_id
        if task_data.get("payload_template"):
            full_task_data["payload_template"] = task_data["payload_template"]
        if task_data.get("url_template"):
            full_task_data["url_template"] = task_data["url_template"]
        if task_data.get("idempotency_key"):
            full_task_data["idempotency_key"] = task_data["idempotency_key"]

        await self.task_model.create(full_task_data)
        return task_id
    
    async def cancel_scheduled_task(self, task_id: str) -> bool:
        """
        Cancel a scheduled task
        
        Args:
            task_id: ID of task to cancel
            
        Returns:
            True if cancelled, False if not found
        """
        task = await self.task_model.find_by_id(task_id)
        if not task:
            return False
        
        if task.get("status") == "queued" and task.get("execution_type") == "scheduled":
            await self.task_model.update_status(task_id, "cancelled")
            return True
        
        return False
    
    async def reschedule_task(
        self, 
        task_id: str, 
        new_scheduled_at: datetime
    ) -> bool:
        """
        Reschedule an existing task
        
        Args:
            task_id: ID of task to reschedule
            new_scheduled_at: New execution time
            
        Returns:
            True if rescheduled, False if not found
        """
        task = await self.task_model.find_by_id(task_id)
        if not task:
            return False
        
        if task.get("execution_type") == "scheduled" and task.get("status") in ["queued", "failed"]:
            # Update the scheduled time
            query = """
                UPDATE tasks 
                SET scheduled_at = ?, updated_at = ?, status = 'queued'
                WHERE id = ?
            """
            
            await self.db.prepare(query).bind(
                new_scheduled_at.isoformat(),
                datetime.now(timezone.utc).isoformat(),
                task_id
            ).run()
            
            return True
        
        return False
    
    async def get_scheduled_tasks(
        self, 
        user_id: str = None,
        status: str = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Get scheduled tasks with optional filtering
        
        Args:
            user_id: Filter by user ID
            status: Filter by status
            limit: Maximum number of tasks to return
            
        Returns:
            List of scheduled tasks
        """
        where_conditions = ["execution_type = 'scheduled'"]
        params = []
        
        if user_id:
            where_conditions.append("user_id = ?")
            params.append(user_id)
        
        if status:
            where_conditions.append("status = ?")
            params.append(status)
        
        query = f"""
            SELECT * FROM tasks 
            WHERE {' AND '.join(where_conditions)}
            ORDER BY scheduled_at ASC
            LIMIT ?
        """
        
        params.append(limit)
        result = await self.db.prepare(query).bind(*params).all()
        
        if result and hasattr(result, 'results'):
            return [task.as_py() if hasattr(task, 'as_py') else task for task in result.results]
        elif result:
            return [result]
        else:
            return []
