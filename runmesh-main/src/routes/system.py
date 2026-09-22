from db.orm import UserModel

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)

from utils.dual_auth import get_jwt_user

from utils.responses import success

router = APIRouter()


@router.get("/")
async def root():
    return success({"name": "Runmesh API", "version": "1.0.0"})


@router.get("/health")
async def health():
    return success({"status": "ok"})


@router.get("/api/me")
async def api_me(request: Request, current_user: dict = Depends(get_jwt_user)):
    env = request.scope["env"]
    user_model = UserModel(env.DB)
    user = await user_model.find_by_id(current_user["id"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return success({
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "avatar_url": user.get("avatar_url", ""),
        "github_login": user.get("github_login", ""),
    })


# API Key Endpoints
