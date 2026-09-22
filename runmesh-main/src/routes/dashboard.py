from fastapi import (
    APIRouter,
    Depends,
    Request,
)

from services.main import get_analytics

from utils.dual_auth import get_jwt_user

router = APIRouter()


@router.get("/api/analytics")
async def dashboard(request: Request, current_user: dict = Depends(get_jwt_user)):
    return await get_analytics(request.scope["env"].DB, current_user["id"])
