import hashlib
import secrets
import json
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import HTTPException, Depends, Request

from db.orm import ApiKeyModel, UserModel

def generate_api_key() -> str:
    return f"rk_{secrets.token_urlsafe(32)}"


def hash_api_key(api_key: str) -> str:
    """Hash an API key for secure storage"""
    return hashlib.sha256(api_key.encode()).hexdigest()

def verify_api_key(api_key: str, key_hash: str) -> bool:
    """Verify an API key against its hash"""
    return hashlib.sha256(api_key.encode()).hexdigest() == key_hash

async def get_api_key_user(
    request: Request,
    required_permissions: List[str] = None
) -> dict:
    """
    Authenticate API key from custom header and return user info
    
    Args:
        request: FastAPI request object
        required_permissions: List of required permissions
        
    Returns:
        User and API key information
        
    Raises:
        HTTPException: If authentication fails
    """
    env = request.scope["env"]
    
    # Get API key from custom header
    api_key = request.headers.get("X-API-Key")
    if not api_key:
        raise HTTPException(status_code=401, detail="API key required in X-API-Key header")
    
    # Validate API key format
    if not api_key.startswith("rk_"):
        raise HTTPException(status_code=401, detail="Invalid API key format")
    
    # Find API key by hash
    api_key_model = ApiKeyModel(env.DB)
    key_hash = hash_api_key(api_key)
    api_key_data = await api_key_model.find_by_key_hash(key_hash)
    
    if not api_key_data:
        raise HTTPException(status_code=401, detail="Invalid API key")
    
    # Check if key is expired
    if api_key_data.get("expires_at"):
        expires_at = datetime.fromisoformat(api_key_data["expires_at"].replace('Z', '+00:00'))
        if expires_at <= datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="API key expired")
    
    # Check permissions
    if required_permissions:
        permissions = json.loads(api_key_data.get("permissions", "[]"))
        for permission in required_permissions:
            if permission not in permissions:
                raise HTTPException(status_code=403, detail=f"Insufficient permissions: {permission} required")
    
    # Get user information
    user_model = UserModel(env.DB)
    user_data = await user_model.find_by_id(api_key_data["user_id"])
    
    if not user_data:
        raise HTTPException(status_code=401, detail="User not found")
    
    # Update last used timestamp
    await api_key_model.update_last_used(api_key_data["id"])
    
    return {
        "user": {
            "id": user_data["id"],
            "email": user_data["email"],
            "name": user_data["name"]
        },
        "api_key": {
            "id": api_key_data["id"],
            "name": api_key_data["name"],
            "permissions": json.loads(api_key_data.get("permissions", "[]")),
            "last_used_at": api_key_data.get("last_used_at")
        }
    }

# Permission constants
PERMISSIONS = {
    "read": "Read access to tasks and data",
    "write": "Create and modify tasks",
    "delete": "Delete tasks and data",
    "admin": "Full administrative access",
    "ai": "Access to AI endpoints"
}
