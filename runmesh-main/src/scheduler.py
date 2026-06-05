from workers import WorkerEntrypoint
from services.scheduler import TaskScheduler

class Default(WorkerEntrypoint):
    """
    Scheduler Worker - Runs on cron schedule to enqueue due tasks
    """
    
    async def scheduled(self, event):
        """
        Called by Cloudflare Cron Triggers
        This runs every minute to check for due tasks
        """
        scheduler = TaskScheduler(self.env.DB, self.env.TASK_QUEUE)
        
        try:
            # Enqueue all tasks that are due for execution
            enqueued_count = await scheduler.enqueue_due_tasks()
            
            if enqueued_count > 0:
                print(f"Enqueued {enqueued_count} scheduled tasks for execution")
            else:
                print("No due tasks found")
                
        except Exception as e:
            print(f"Scheduler error: {e}")
            raise e
    
    async def fetch(self, request):
        """Handle HTTP requests for scheduler management"""
        import json
        from utils.types import SummarizeRequest
        from utils.auth import get_current_user
        from fastapi import Request, HTTPException, Depends
        
        # Basic API endpoints for scheduler management
        if request.method == "GET" and request.url == "/scheduler/status":
            return {"status": "running", "type": "scheduler"}
        
        if request.method == "GET" and request.url.startswith("/scheduler/tasks"):
            # Parse query parameters for filtering
            url_parts = request.url.split("?")
            query_params = {}
            if len(url_parts) > 1:
                for param in url_parts[1].split("&"):
                    if "=" in param:
                        key, value = param.split("=", 1)
                        query_params[key] = value
            
            scheduler = TaskScheduler(self.env.DB, self.env.TASK_QUEUE)
            
            # Get user ID from auth header if present
            user_id = None
            auth_header = request.headers.get("authorization")
            if auth_header and auth_header.startswith("Bearer "):
                from utils.auth import decode_token
                token = auth_header[7:]  # Remove "Bearer "
                payload = decode_token(token, self.env.JWT_SECRET)
                if payload:
                    user_id = payload.get("id")
            
            # Get scheduled tasks with filtering
            tasks = await scheduler.get_scheduled_tasks(
                user_id=user_id,
                status=query_params.get("status"),
                limit=int(query_params.get("limit", 50))
            )
            
            return {"tasks": tasks, "count": len(tasks)}
        
        return {"message": "Scheduler worker - use cron triggers"}
