from fastapi import (
    APIRouter,
    Depends,
    Request,
)

from services import policies as policies_service

from services.workspaces import resolve_request_workspace

from utils.dual_auth import get_jwt_user

from utils.types import (
    PolicyEvaluateRequest,
    PolicyReorderRequest,
    PolicyRuleCreateRequest,
    PolicyRuleUpdateRequest,
)

router = APIRouter()


@router.get("/api/v1/policies/rules")
async def list_rules(request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await policies_service.list_rules(env.DB, current_user["id"], workspace_id)


@router.post("/api/v1/policies/rules")
async def create_rule(req: PolicyRuleCreateRequest, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await policies_service.create_rule(env.DB, current_user["id"], workspace_id, req)


@router.patch("/api/v1/policies/rules/{rule_id}")
async def update_rule(rule_id: str, req: PolicyRuleUpdateRequest, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await policies_service.update_rule(env.DB, current_user["id"], workspace_id, rule_id, req)


@router.delete("/api/v1/policies/rules/{rule_id}")
async def delete_rule(rule_id: str, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await policies_service.delete_rule(env.DB, current_user["id"], workspace_id, rule_id)


@router.post("/api/v1/policies/rules/reorder")
async def reorder_rules(req: PolicyReorderRequest, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await policies_service.reorder_rules(env.DB, current_user["id"], workspace_id, req.ids)


@router.post("/api/v1/policies/evaluate")
async def evaluate(req: PolicyEvaluateRequest, request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await policies_service.evaluate_request(env.DB, current_user["id"], workspace_id, req)


@router.get("/api/v1/policies/coverage-gaps")
async def coverage_gaps(request: Request, current_user: dict = Depends(get_jwt_user)):
    """Actions that fell to the default — wanted, but no rule covered them."""
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await policies_service.coverage_gaps(env.DB, current_user["id"], workspace_id)


@router.get("/api/v1/policies/capability-matrix")
async def capability_matrix(request: Request, current_user: dict = Depends(get_jwt_user)):
    """Resolved decision per agent per known action, projected from the rules."""
    env = request.scope["env"]
    workspace_id = await resolve_request_workspace(request, current_user)
    return await policies_service.capability_matrix(env.DB, current_user["id"], workspace_id)
