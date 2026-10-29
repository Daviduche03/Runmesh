import secrets

from db.connect_orm import ConnectAppModel
from utils.api_auth import hash_api_key
from utils.types import (
    ConnectAppCreate,
    ConnectAppRow,
)


async def ensure_workspace_app(
    app_model: ConnectAppModel,
    workspace_id: str,
    developer_user_id: str,
) -> ConnectAppRow:
    """The workspace's singleton OAuth client. Created on first use —
    there is no app management UI by design."""
    existing = await app_model.find_by_workspace(workspace_id)
    if existing is not None:
        return existing
    return await app_model.create(
        ConnectAppCreate(
            developer_user_id=developer_user_id,
            name="Default",
            slug=f"ws-{workspace_id[:8]}",
            client_secret_hash=hash_api_key(secrets.token_urlsafe(32)),
            redirect_uris=[],
            allowed_providers=[],
            workspace_id=workspace_id,
        )
    )
