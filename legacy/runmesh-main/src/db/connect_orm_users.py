from __future__ import annotations

import uuid

from db.orm import Model

from typing import Any

from utils.types import (
    ConnectAccountSessionCreate,
    ConnectAccountSessionRow,
    ConnectIdentityCreate,
    ConnectIdentityProvider,
    ConnectIdentityRow,
    ConnectOtpChallengeCreate,
    ConnectOtpChallengeRow,
    ConnectOtpStatus,
    ConnectUserCreate,
    ConnectUserRow,
    utc_now_iso,
)

from db.connect_orm_common import (
    _dump_create,
    _rows,
)


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

    async def count_recent_for_email(self, email: str, since_iso: str) -> int:
        """Count challenges created for an email since a timestamp (OTP throttling)."""
        result = await self.db.prepare(
            "SELECT COUNT(*) AS cnt FROM connect_otp_challenges WHERE email = ? AND created_at >= ?"
        ).bind(email, since_iso).first()
        if result is None:
            return 0
        if hasattr(result, "as_py"):
            result = result.as_py()
        elif hasattr(result, "to_py"):
            result = result.to_py()
        elif not isinstance(result, dict):
            result = dict(result)
        return int(result.get("cnt", 0))


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


