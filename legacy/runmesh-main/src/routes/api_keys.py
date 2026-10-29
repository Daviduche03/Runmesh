from db.orm import ApiKeyModel

from fastapi import (
    APIRouter,
    Depends,
    Request,
)

from services import api_keys as api_keys_service

from services.workspaces import resolve_request_workspace

from utils.dual_auth import get_jwt_user

from utils.types import ApiKeyCreateRequest

router = APIRouter()


@router.post("/api-keys")
async def create_api_key(req: ApiKeyCreateRequest, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await api_keys_service.create_api_key(ApiKeyModel(env.DB), req, current_user["id"], workspace_id)


@router.get("/api-keys")
async def list_api_keys(request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await api_keys_service.list_api_keys(ApiKeyModel(env.DB), current_user["id"], workspace_id)


@router.delete("/api-keys/{key_id}")
async def delete_api_key(key_id: str, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    return await api_keys_service.delete_api_key(ApiKeyModel(env.DB), key_id, current_user["id"])
