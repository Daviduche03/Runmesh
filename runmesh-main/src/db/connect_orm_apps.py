from __future__ import annotations

import uuid

from db.orm import Model

from utils.types import (
    ConnectAppCreate,
    ConnectAppRow,
    ConnectAppStatus,
    ConnectAppUserCreate,
    ConnectAppUserRow,
    ConnectConnectionCreate,
    ConnectConnectionRow,
    ConnectConnectionStatus,
    ConnectConnectionUpdate,
    utc_now_iso,
)

from db.connect_orm_common import (
    _dump_create,
    _rows,
)


class ConnectAppModel(Model):
    async def create(self, payload: ConnectAppCreate) -> ConnectAppRow:
        data = _dump_create(payload)
        now = utc_now_iso()
        data["id"] = str(uuid.uuid4())
        data["created_at"] = now
        data["updated_at"] = now
        await self.insert("connect_apps", data)
        row = await self.find_by_id(data["id"])
        if row is None:
            raise RuntimeError("connect app insert failed")
        return row

    async def find_by_id(self, connect_app_id: str) -> ConnectAppRow | None:
        raw = await self.find_one("connect_apps", "id = ?", connect_app_id)
        return ConnectAppRow.from_row(raw)

    async def find_by_slug(self, developer_user_id: str, slug: str) -> ConnectAppRow | None:
        raw = await self.find_one(
            "connect_apps",
            "developer_user_id = ? AND slug = ?",
            developer_user_id,
            slug,
        )
        return ConnectAppRow.from_row(raw)

    async def list_by_developer_user_id(self, developer_user_id: str) -> list[ConnectAppRow]:
        raw_rows = await self.find_many(
            "connect_apps",
            "developer_user_id = ? ORDER BY created_at DESC",
            developer_user_id,
        )
        return _rows(raw_rows, ConnectAppRow)

    async def find_by_workspace(self, workspace_id: str) -> ConnectAppRow | None:
        raw = await self.find_one(
            "connect_apps",
            "workspace_id = ?",
            workspace_id,
        )
        return ConnectAppRow.from_row(raw)

    async def update_status(self, connect_app_id: str, status: ConnectAppStatus) -> int:
        return await self.update(
            "connect_apps",
            "id = ?",
            {"status": status.value, "updated_at": utc_now_iso()},
            connect_app_id,
        )

    async def delete_app(self, connect_app_id: str) -> int:
        return await super().delete("connect_apps", "id = ?", connect_app_id)


class ConnectAppUserModel(Model):
    async def create(self, payload: ConnectAppUserCreate) -> ConnectAppUserRow:
        data = _dump_create(payload)
        now = utc_now_iso()
        data["id"] = str(uuid.uuid4())
        data["created_at"] = now
        data["updated_at"] = now
        await self.insert("connect_app_users", data)
        row = await self.find_by_id(data["id"])
        if row is None:
            raise RuntimeError("connect app user insert failed")
        return row

    async def find_by_id(self, app_user_id: str) -> ConnectAppUserRow | None:
        raw = await self.find_one("connect_app_users", "id = ?", app_user_id)
        return ConnectAppUserRow.from_row(raw)

    async def find_by_external_user(
        self,
        connect_app_id: str,
        external_user_id: str,
    ) -> ConnectAppUserRow | None:
        raw = await self.find_one(
            "connect_app_users",
            "connect_app_id = ? AND external_user_id = ?",
            connect_app_id,
            external_user_id,
        )
        return ConnectAppUserRow.from_row(raw)

    async def find_by_connect_user(
        self,
        connect_app_id: str,
        connect_user_id: str,
    ) -> ConnectAppUserRow | None:
        raw = await self.find_one(
            "connect_app_users",
            "connect_app_id = ? AND connect_user_id = ?",
            connect_app_id,
            connect_user_id,
        )
        return ConnectAppUserRow.from_row(raw)

    async def link_user(
        self,
        connect_app_id: str,
        external_user_id: str,
        connect_user_id: str,
    ) -> ConnectAppUserRow:
        existing = await self.find_by_external_user(connect_app_id, external_user_id)
        now = utc_now_iso()
        if existing is not None:
            if existing.connect_user_id == connect_user_id:
                return existing
            await self.update(
                "connect_app_users",
                "id = ?",
                {"connect_user_id": connect_user_id, "updated_at": now},
                existing.id,
            )
            updated = await self.find_by_id(existing.id)
            if updated is None:
                raise RuntimeError("connect app user update failed")
            return updated
        return await self.create(
            ConnectAppUserCreate(
                connect_app_id=connect_app_id,
                external_user_id=external_user_id,
                connect_user_id=connect_user_id,
            )
        )


class ConnectConnectionModel(Model):
    async def create(self, payload: ConnectConnectionCreate) -> ConnectConnectionRow:
        data = _dump_create(payload)
        now = utc_now_iso()
        data["id"] = str(uuid.uuid4())
        data["created_at"] = now
        data["updated_at"] = now
        await self.insert("connect_connections", data)
        row = await self.find_by_id(data["id"])
        if row is None:
            raise RuntimeError("connect connection insert failed")
        return row

    async def find_by_id(self, connection_id: str) -> ConnectConnectionRow | None:
        raw = await self.find_one("connect_connections", "id = ?", connection_id)
        return ConnectConnectionRow.from_row(raw)

    async def find_by_user_provider(
        self,
        connect_user_id: str,
        provider: str,
    ) -> ConnectConnectionRow | None:
        raw = await self.find_one(
            "connect_connections",
            "connect_user_id = ? AND provider = ?",
            connect_user_id,
            provider,
        )
        return ConnectConnectionRow.from_row(raw)

    async def update_connection(self, connection_id: str, payload: ConnectConnectionUpdate) -> int:
        data = _dump_create(payload)
        if not data:
            return 0
        data["updated_at"] = utc_now_iso()
        return await self.update("connect_connections", "id = ?", data, connection_id)

    async def list_by_workspace(
        self,
        workspace_id: str,
        *,
        provider: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ConnectConnectionRow]:
        conditions = ["workspace_id = ?"]
        params: list = [workspace_id]
        if provider:
            conditions.append("provider = ?")
            params.append(provider)
        if status:
            conditions.append("status = ?")
            params.append(status)
        where = " AND ".join(conditions) + " ORDER BY created_at DESC"
        raw_rows = await self.find_many("connect_connections", where, *params, limit=limit, offset=offset)
        return [ConnectConnectionRow.from_row(r) for r in raw_rows if r]

    async def count_by_workspace(
        self,
        workspace_id: str,
        *,
        provider: str | None = None,
        status: str | None = None,
    ) -> int:
        conditions = ["workspace_id = ?"]
        params: list = [workspace_id]
        if provider:
            conditions.append("provider = ?")
            params.append(provider)
        if status:
            conditions.append("status = ?")
            params.append(status)
        where = " AND ".join(conditions)
        result = await self.db.prepare(
            f"SELECT COUNT(*) as cnt FROM connect_connections WHERE {where}"
        ).bind(*params).first()
        if not result:
            return 0
        if hasattr(result, "as_py"):
            result = result.as_py()
        elif hasattr(result, "to_py"):
            result = result.to_py()
        elif not isinstance(result, dict):
            result = dict(result)
        return result.get("cnt", 0)

    async def revoke(self, connection_id: str) -> int:
        now = utc_now_iso()
        return await self.update(
            "connect_connections",
            "id = ?",
            {
                "status": ConnectConnectionStatus.REVOKED.value,
                "revoked_at": now,
                "updated_at": now,
            },
            connection_id,
        )


