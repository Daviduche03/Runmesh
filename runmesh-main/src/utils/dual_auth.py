import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import Request, HTTPException

from db.orm import ApiKeyModel, UserModel
from utils.auth import decode_token
from utils.api_auth import hash_api_key


async def get_jwt_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer token required")
    payload = decode_token(auth_header[7:], request.scope["env"].JWT_SECRET)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    return payload


async def get_authenticated_user(
    request: Request,
    required_permissions: Optional[list[str]] = None,
) -> dict:
    env = request.scope["env"]
    api_key = request.headers.get("X-API-Key")

    if api_key:
        if not api_key.startswith("rk_"):
            raise HTTPException(status_code=401, detail="Invalid API key format")

        api_key_model = ApiKeyModel(env.DB)
        api_key_data = await api_key_model.find_by_key_hash(hash_api_key(api_key))
        if not api_key_data:
            raise HTTPException(status_code=401, detail="Invalid API key")

        if api_key_data.get("expires_at"):
            expires_at = datetime.fromisoformat(api_key_data["expires_at"].replace("Z", "+00:00"))
            if expires_at <= datetime.now(timezone.utc):
                raise HTTPException(status_code=401, detail="API key expired")

        permissions = json.loads(api_key_data.get("permissions", "[]"))
        if required_permissions:
            if "admin" not in permissions:
                for permission in required_permissions:
                    if permission not in permissions:
                        raise HTTPException(
                            status_code=403,
                            detail=f"Insufficient permissions: {permission} required",
                        )

        user_model = UserModel(env.DB)
        user_data = await user_model.find_by_id(api_key_data["user_id"])
        if not user_data:
            raise HTTPException(status_code=401, detail="User not found")

        await api_key_model.update_last_used(api_key_data["id"])
        return {
            "id": user_data["id"],
            "email": user_data["email"],
            "name": user_data["name"],
        }

    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        payload = decode_token(auth_header[7:], env.JWT_SECRET)
        if payload:
            return payload
        raise HTTPException(status_code=401, detail="Invalid token")

    raise HTTPException(
        status_code=401,
        detail="Authentication required. Use Authorization: Bearer <token> or X-API-Key header.",
    )


def require_auth(*permissions: str):
    async def dependency(request: Request) -> dict:
        return await get_authenticated_user(
            request,
            list(permissions) if permissions else None,
        )

    return dependency
