from __future__ import annotations

import uuid

from db.orm import Model

from utils.types import (
    ConnectAuditEventCreate,
    ConnectAuditEventRow,
    ConnectGrantCreate,
    ConnectGrantRow,
    ConnectGrantStatus,
    ConnectSessionCreate,
    ConnectSessionRow,
    ConnectSessionStatus,
    ConnectSessionUpdate,
    utc_now_iso,
)

from db.connect_orm_common import (
    _dump_create,
    _rows,
)


class ConnectGrantModel(Model):
    async def create(self, payload: ConnectGrantCreate) -> ConnectGrantRow:
        data = _dump_create(payload)
        now = utc_now_iso()
        data["id"] = str(uuid.uuid4())
        data["granted_at"] = payload.granted_at or now
        data["created_at"] = now
        data["updated_at"] = now
        await self.insert("connect_grants", data)
        row = await self.find_by_id(data["id"])
        if row is None:
            raise RuntimeError("connect grant insert failed")
        return row

    async def find_by_id(self, grant_id: str) -> ConnectGrantRow | None:
        raw = await self.find_one("connect_grants", "id = ?", grant_id)
        return ConnectGrantRow.from_row(raw)

    async def find_active(
        self,
        connect_app_id: str,
        connect_user_id: str,
        connection_id: str,
        workspace_id: str | None = None,
    ) -> ConnectGrantRow | None:
        where = "connect_app_id = ? AND connect_user_id = ? AND connection_id = ? AND status = ?"
        params: list = [connect_app_id, connect_user_id, connection_id, ConnectGrantStatus.ACTIVE.value]
        if workspace_id:
            where += " AND workspace_id = ?"
            params.append(workspace_id)
        raw = await self.find_one("connect_grants", where, *params)
        return ConnectGrantRow.from_row(raw)

    async def list_by_workspace(
        self,
        workspace_id: str,
        *,
        ui_status: str | None = None,
        agent_id: str | None = None,
        now: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ConnectGrantRow]:
        """Workspace-wide grant list. ui_status is one of
        pending | active | expired | revoked | denied (derived from
        status + approval_status + valid_until)."""
        conditions = ["workspace_id = ?"]
        params: list = [workspace_id]
        if agent_id:
            conditions.append("agent_id = ?")
            params.append(agent_id)
        if ui_status == "pending":
            conditions.append("approval_status = 'pending_approval' AND status = 'active'")
        elif ui_status == "active":
            conditions.append("approval_status = 'approved' AND status = 'active'")
            if now is not None:
                conditions.append("(valid_until IS NULL OR valid_until > ?)")
                params.append(now)
        elif ui_status == "expired":
            conditions.append("approval_status = 'approved' AND status = 'active' AND valid_until IS NOT NULL")
            if now is not None:
                conditions.append("valid_until <= ?")
                params.append(now)
        elif ui_status == "revoked":
            conditions.append("status = 'revoked'")
        elif ui_status == "denied":
            conditions.append("approval_status = 'denied'")
        where = " AND ".join(conditions) + " ORDER BY created_at DESC"
        raw_rows = await self.find_many("connect_grants", where, *params, limit=limit, offset=offset)
        return _rows(raw_rows, ConnectGrantRow)

    async def count_by_workspace(
        self,
        workspace_id: str,
        *,
        ui_status: str | None = None,
        agent_id: str | None = None,
        now: str | None = None,
    ) -> int:
        conditions = ["workspace_id = ?"]
        params: list = [workspace_id]
        if agent_id:
            conditions.append("agent_id = ?")
            params.append(agent_id)
        if ui_status == "pending":
            conditions.append("approval_status = 'pending_approval' AND status = 'active'")
        elif ui_status == "active":
            conditions.append("approval_status = 'approved' AND status = 'active'")
            if now is not None:
                conditions.append("(valid_until IS NULL OR valid_until > ?)")
                params.append(now)
        elif ui_status == "expired":
            conditions.append("approval_status = 'approved' AND status = 'active' AND valid_until IS NOT NULL")
            if now is not None:
                conditions.append("valid_until <= ?")
                params.append(now)
        elif ui_status == "revoked":
            conditions.append("status = 'revoked'")
        elif ui_status == "denied":
            conditions.append("approval_status = 'denied'")
        where = " AND ".join(conditions)
        result = await self.db.prepare(
            f"SELECT COUNT(*) as cnt FROM connect_grants WHERE {where}"
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

    async def revoke(self, grant_id: str) -> int:
        now = utc_now_iso()
        return await self.update(
            "connect_grants",
            "id = ?",
            {
                "status": ConnectGrantStatus.REVOKED.value,
                "revoked_at": now,
                "updated_at": now,
            },
            grant_id,
        )

    async def update_grant(self, grant_id: str, updates: dict) -> int:
        """Update grant with dict of fields."""
        updates["updated_at"] = utc_now_iso()
        return await self.update(
            "connect_grants",
            "id = ?",
            updates,
            grant_id,
        )

class ConnectSessionModel(Model):
    async def create(self, payload: ConnectSessionCreate) -> ConnectSessionRow:
        data = _dump_create(payload)
        data["id"] = str(uuid.uuid4())
        data["created_at"] = utc_now_iso()
        await self.insert("connect_sessions", data)
        row = await self.find_by_id(data["id"])
        if row is None:
            raise RuntimeError("connect session insert failed")
        return row

    async def find_by_id(self, session_id: str) -> ConnectSessionRow | None:
        raw = await self.find_one("connect_sessions", "id = ?", session_id)
        return ConnectSessionRow.from_row(raw)

    async def find_by_state(self, state: str) -> ConnectSessionRow | None:
        raw = await self.find_one("connect_sessions", "state = ?", state)
        return ConnectSessionRow.from_row(raw)

    async def update_session(self, session_id: str, payload: ConnectSessionUpdate) -> int:
        data = _dump_create(payload)
        if not data:
            return 0
        return await self.update("connect_sessions", "id = ?", data, session_id)

    async def complete(self, session_id: str, connect_user_id: str) -> int:
        now = utc_now_iso()
        return await self.update(
            "connect_sessions",
            "id = ?",
            {
                "connect_user_id": connect_user_id,
                "status": ConnectSessionStatus.COMPLETED.value,
                "completed_at": now,
            },
            session_id,
        )


class ConnectAuditEventModel(Model):
    async def create(self, payload: ConnectAuditEventCreate) -> ConnectAuditEventRow:
        data = _dump_create(payload)
        data["id"] = str(uuid.uuid4())
        data["created_at"] = utc_now_iso()
        await self.insert("connect_audit_events", data)
        row = await self.find_by_id(data["id"])
        if row is None:
            raise RuntimeError("connect audit event insert failed")
        return row

    async def find_by_id(self, event_id: str) -> ConnectAuditEventRow | None:
        raw = await self.find_one("connect_audit_events", "id = ?", event_id)
        return ConnectAuditEventRow.from_row(raw)

    async def find_token_exchanges(
        self,
        workspace_id: str,
        task_id: str | None = None,
        workflow_run_id: str | None = None,
        workspace_project_id: str | None = None,
        limit: int = 50,
    ) -> list[ConnectAuditEventRow]:
        conditions = ["event_type = 'connect.token.exchanged'", "workspace_id = ?"]
        params: list[str] = [workspace_id]
        if task_id is not None:
            conditions.append("json_extract(metadata, '$.task_id') = ?")
            params.append(task_id)
        if workflow_run_id is not None:
            conditions.append("json_extract(metadata, '$.workflow_run_id') = ?")
            params.append(workflow_run_id)
        if workspace_project_id is not None:
            conditions.append("json_extract(metadata, '$.workspace_project_id') = ?")
            params.append(workspace_project_id)
        where = " AND ".join(conditions)
        raw_rows = await self.find_many("connect_audit_events", where, *params, limit=limit)
        return [ConnectAuditEventRow.from_row(r) for r in raw_rows if r]

    async def list_all(
        self,
        workspace_id: str,
        event_type: str | None = None,
        connect_user_id: str | None = None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[ConnectAuditEventRow], int]:
        conditions = ["workspace_id = ?"]
        params: list[str] = [workspace_id]
        if event_type is not None:
            conditions.append("event_type = ?")
            params.append(event_type)
        if connect_user_id is not None:
            conditions.append("connect_user_id = ?")
            params.append(connect_user_id)
        if search is not None:
            conditions.append("(event_type LIKE ? OR actor_id LIKE ? OR resource_id LIKE ? OR connect_user_id LIKE ?)")
            like = f"%{search}%"
            params.extend([like, like, like, like])
        where = " AND ".join(conditions) if conditions else "1=1"

        count_result = await self.db.prepare(
            f"SELECT COUNT(*) as cnt FROM connect_audit_events WHERE {where}"
        ).bind(*params).all()
        if count_result:
            raw_list = count_result.results if hasattr(count_result, 'results') else list(count_result) if count_result else []
            if raw_list:
                first = raw_list[0]
                if hasattr(first, 'as_py'):
                    total = first.as_py().get("cnt", 0)
                elif hasattr(first, 'to_py'):
                    total = first.to_py().get("cnt", 0)
                elif isinstance(first, dict):
                    total = first.get("cnt", 0)
                else:
                    total = dict(first).get("cnt", 0)
            else:
                total = 0
        else:
            total = 0

        raw_rows = await self.find_many(
            "connect_audit_events",
            f"{where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            *params, str(limit), str(offset),
        )
        rows = [ConnectAuditEventRow.from_row(r) for r in raw_rows if r]
        return rows, total

