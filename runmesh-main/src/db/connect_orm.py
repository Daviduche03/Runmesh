from __future__ import annotations

import json
import uuid
from enum import Enum
from typing import Any, TypeVar

from pydantic import BaseModel

from utils.types import (
    ConnectAccountSessionCreate,
    ConnectAccountSessionRow,
    ConnectAppCreate,
    ConnectAppRow,
    ConnectAppStatus,
    ConnectAppUserCreate,
    ConnectAppUserRow,
    ConnectAuditEventCreate,
    ConnectAuditEventRow,
    ConnectConnectionCreate,
    ConnectConnectionRow,
    ConnectConnectionStatus,
    ConnectConnectionUpdate,
    ConnectGrantCreate,
    ConnectGrantRow,
    ConnectGrantStatus,
    ConnectIdentityCreate,
    ConnectIdentityProvider,
    ConnectIdentityRow,
    ConnectOtpChallengeCreate,
    ConnectOtpChallengeRow,
    ConnectOtpStatus,
    ConnectRowBase,
    ConnectSessionCreate,
    ConnectSessionRow,
    ConnectSessionStatus,
    ConnectSessionUpdate,
    ConnectUserCreate,
    ConnectUserRow,
    utc_now_iso,
)
from db.orm import Model

TRow = TypeVar("TRow", bound=ConnectRowBase)


def _dump_create(model: BaseModel) -> dict[str, Any]:
    data = model.model_dump(exclude_none=True)
    for key, value in list(data.items()):
        if isinstance(value, Enum):
            data[key] = value.value
        elif isinstance(value, list):
            data[key] = json.dumps(value)
        elif isinstance(value, dict):
            data[key] = json.dumps(value)
        elif isinstance(value, bool):
            data[key] = 1 if value else 0
    return data


def _rows(raw_rows: list[dict[str, Any]], row_model: type[TRow]) -> list[TRow]:
    out: list[TRow] = []
    for raw in raw_rows:
        row = row_model.from_row(raw)
        if row is not None:
            out.append(row)
    return out


class ConnectUserModel(Model):
    async def create(self, payload: ConnectUserCreate | None = None) -> ConnectUserRow:
        data = _dump_create(payload or ConnectUserCreate())
        now = utc_now_iso()
        data["id"] = str(uuid.uuid4())
        data["created_at"] = now
        data["updated_at"] = now
        await self.insert("connect_users", data)
        row = await self.find_by_id(data["id"])
        if row is None:
            raise RuntimeError("connect user insert failed")
        return row

    async def find_by_id(self, connect_user_id: str) -> ConnectUserRow | None:
        raw = await self.find_one("connect_users", "id = ?", connect_user_id)
        return ConnectUserRow.from_row(raw)

    async def update_status(self, connect_user_id: str, status: str) -> int:
        return await self.update(
            "connect_users",
            "id = ?",
            {"status": status, "updated_at": utc_now_iso()},
            connect_user_id,
        )

    async def find_by_primary_email(self, email: str) -> ConnectUserRow | None:
        raw = await self.find_one(
            "connect_users",
            "LOWER(primary_email) = LOWER(?) AND primary_email_verified = 1",
            email.strip(),
        )
        return ConnectUserRow.from_row(raw)

    async def update_primary_email(
        self,
        connect_user_id: str,
        email: str,
        *,
        verified: bool,
    ) -> int:
        return await self.update(
            "connect_users",
            "id = ?",
            {
                "primary_email": email.strip().lower(),
                "primary_email_verified": 1 if verified else 0,
                "updated_at": utc_now_iso(),
            },
            connect_user_id,
        )


class ConnectAccountSessionModel(Model):
    async def create(self, payload: ConnectAccountSessionCreate) -> ConnectAccountSessionRow:
        data = _dump_create(payload)
        now = utc_now_iso()
        data["id"] = str(uuid.uuid4())
        data["created_at"] = now
        await self.insert("connect_account_sessions", data)
        row = await self.find_by_token_hash(payload.token_hash)
        if row is None:
            raise RuntimeError("connect account session insert failed")
        return row

    async def find_by_token_hash(self, token_hash: str) -> ConnectAccountSessionRow | None:
        raw = await self.find_one("connect_account_sessions", "token_hash = ?", token_hash)
        return ConnectAccountSessionRow.from_row(raw)


class ConnectOtpChallengeModel(Model):
    async def create(self, payload: ConnectOtpChallengeCreate) -> ConnectOtpChallengeRow:
        data = _dump_create(payload)
        data["id"] = str(uuid.uuid4())
        data["created_at"] = utc_now_iso()
        await self.insert("connect_otp_challenges", data)
        row = await self.find_by_id(data["id"])
        if row is None:
            raise RuntimeError("connect otp challenge insert failed")
        return row

    async def find_by_id(self, challenge_id: str) -> ConnectOtpChallengeRow | None:
        raw = await self.find_one("connect_otp_challenges", "id = ?", challenge_id)
        return ConnectOtpChallengeRow.from_row(raw)

    async def find_pending_for_session(self, connect_session_id: str) -> ConnectOtpChallengeRow | None:
        raw_rows = await self.find_many(
            "connect_otp_challenges",
            "connect_session_id = ? AND status = ? ORDER BY created_at DESC",
            connect_session_id,
            ConnectOtpStatus.PENDING.value,
        )
        rows = _rows(raw_rows, ConnectOtpChallengeRow)
        return rows[0] if rows else None

    async def update_challenge(self, challenge_id: str, data: dict[str, Any]) -> int:
        payload = dict(data)
        return await self.update("connect_otp_challenges", "id = ?", payload, challenge_id)


class ConnectIdentityModel(Model):
    async def create(self, payload: ConnectIdentityCreate) -> ConnectIdentityRow:
        data = _dump_create(payload)
        now = utc_now_iso()
        data["id"] = str(uuid.uuid4())
        data["created_at"] = now
        data["updated_at"] = now
        await self.insert("connect_identities", data)
        row = await self.find_by_id(data["id"])
        if row is None:
            raise RuntimeError("connect identity insert failed")
        return row

    async def find_by_id(self, identity_id: str) -> ConnectIdentityRow | None:
        raw = await self.find_one("connect_identities", "id = ?", identity_id)
        return ConnectIdentityRow.from_row(raw)

    async def find_by_provider_subject(
        self,
        provider: ConnectIdentityProvider | str,
        provider_subject: str,
    ) -> ConnectIdentityRow | None:
        provider_value = provider.value if isinstance(provider, ConnectIdentityProvider) else provider
        raw = await self.find_one(
            "connect_identities",
            "provider = ? AND provider_subject = ?",
            provider_value,
            provider_subject,
        )
        return ConnectIdentityRow.from_row(raw)

    async def list_verified_by_email(self, email: str) -> list[ConnectIdentityRow]:
        raw_rows = await self.find_many(
            "connect_identities",
            "LOWER(email) = LOWER(?) AND email_verified = 1 ORDER BY created_at ASC",
            email.strip(),
        )
        return _rows(raw_rows, ConnectIdentityRow)


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
    ) -> ConnectGrantRow | None:
        raw = await self.find_one(
            "connect_grants",
            "connect_app_id = ? AND connect_user_id = ? AND connection_id = ? AND status = ?",
            connect_app_id,
            connect_user_id,
            connection_id,
            ConnectGrantStatus.ACTIVE.value,
        )
        return ConnectGrantRow.from_row(raw)

    async def list_by_connect_app_id(self, connect_app_id: str) -> list[ConnectGrantRow]:
        raw_rows = await self.find_many(
            "connect_grants",
            "connect_app_id = ? ORDER BY granted_at DESC",
            connect_app_id,
        )
        return _rows(raw_rows, ConnectGrantRow)

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

