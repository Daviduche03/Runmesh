from db.orm import (
    WebhookDeadLetterModel,
    WebhookModel,
)

from fastapi import (
    APIRouter,
    Depends,
    Request,
)

from services import webhooks as webhooks_service

from services.workspaces import resolve_request_workspace

from utils.dual_auth import get_jwt_user

from utils.responses import success

from utils.types import WebhookCreateRequest

router = APIRouter()


@router.get("/api/webhooks")
async def list_webhooks(request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    items = await webhooks_service.list_webhooks(WebhookModel(env.DB), current_user["id"], workspace_id)
    return success(items, meta={"total": len(items)})


@router.post("/api/webhooks")
async def create_webhook(req: WebhookCreateRequest, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    item = await webhooks_service.create_webhook(
        WebhookModel(env.DB),
        req.name,
        req.url,
        req.events,
        current_user["id"],
        workspace_id,
    )
    return success(item, message="Webhook created")


@router.get("/api/webhooks/dead-letters")
async def list_webhook_dead_letters(request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    include_replayed = request.query_params.get("include_replayed") == "1"
    workspace_id = await resolve_request_workspace(request, current_user)
    items = await webhooks_service.list_dead_letters(
        WebhookDeadLetterModel(env.DB),
        current_user["id"],
        include_replayed=include_replayed,
        workspace_id=workspace_id,
    )
    return success(items, meta={"total": len(items)})


@router.post("/api/webhooks/dead-letters/{dead_letter_id}/replay")
async def replay_webhook_dead_letter(dead_letter_id: str, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    item = await webhooks_service.replay_dead_letter(
        WebhookDeadLetterModel(env.DB),
        env.WEBHOOK_QUEUE,
        dead_letter_id,
        current_user["id"],
    )
    return success(item, message="Dead letter replay queued")


@router.delete("/api/webhooks/dead-letters/{dead_letter_id}")
async def dismiss_webhook_dead_letter(dead_letter_id: str, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    deleted_id = await webhooks_service.dismiss_dead_letter(
        WebhookDeadLetterModel(env.DB),
        dead_letter_id,
        current_user["id"],
    )
    return success({"id": deleted_id}, message="Dead letter dismissed")


@router.post("/api/webhooks/{webhook_id}/rotate-secret")
async def rotate_webhook_secret(webhook_id: str, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    item = await webhooks_service.rotate_webhook_secret(
        WebhookModel(env.DB),
        webhook_id,
        current_user["id"],
    )
    return success(item, message="Webhook secret rotated")


@router.delete("/api/webhooks/{webhook_id}")
async def delete_webhook(webhook_id: str, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    deleted_id = await webhooks_service.delete_webhook(
        WebhookModel(env.DB),
        webhook_id,
        current_user["id"],
    )
    return success({"id": deleted_id}, message="Webhook deleted")


# API v1 — tasks & workflows (JWT or API key)
