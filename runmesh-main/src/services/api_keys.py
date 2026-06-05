import json
from datetime import datetime, timezone
from db.orm import ApiKeyModel
from fastapi import HTTPException
from utils.api_auth import generate_api_key, hash_api_key, PERMISSIONS
from utils.responses import success


async def create_api_key(api_key_model: ApiKeyModel, req, user_id: str) -> dict:
    valid_permissions = list(PERMISSIONS.keys())
    for permission in req.permissions:
        if permission not in valid_permissions:
            raise HTTPException(status_code=400, detail=f"Invalid permission: {permission}")

    api_key = generate_api_key()
    key_hash = hash_api_key(api_key)

    expires_at = None
    if req.expires_at:
        try:
            expires_at = datetime.fromisoformat(req.expires_at.replace('Z', '+00:00'))
            if expires_at <= datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="expires_at must be in the future")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid expires_at format. Use ISO datetime.")

    key_data = {
        "key_hash": key_hash,
        "name": req.name,
        "user_id": user_id,
        "permissions": json.dumps(req.permissions),
    }
    if req.expires_at:
        key_data["expires_at"] = req.expires_at

    key_id = await api_key_model.create(key_data)
    return success(
        {
            "id": key_id,
            "name": req.name,
            "key": api_key,
            "permissions": req.permissions,
            "expires_at": req.expires_at,
        },
        message="API key created",
    )


async def list_api_keys(api_key_model: ApiKeyModel, user_id: str) -> dict:
    api_keys = await api_key_model.find_by_user_id(user_id)
    safe_keys = []
    for key in api_keys:
        safe_keys.append({
            "id": key["id"],
            "name": key["name"],
            "permissions": json.loads(key.get("permissions", "[]")),
            "created_at": key["created_at"],
            "last_used_at": key.get("last_used_at") or None,
            "expires_at": key.get("expires_at") or None,
        })
    return success(safe_keys, meta={"total": len(safe_keys)})


async def delete_api_key(api_key_model: ApiKeyModel, key_id: str, user_id: str) -> dict:
    api_keys = await api_key_model.find_by_user_id(user_id, limit=100)
    user_key_ids = [key["id"] for key in api_keys]

    if key_id not in user_key_ids:
        raise HTTPException(status_code=404, detail="API key not found")

    success = await api_key_model.deactivate(key_id)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to delete API key")

    return success({"id": key_id}, message="API key deleted")
