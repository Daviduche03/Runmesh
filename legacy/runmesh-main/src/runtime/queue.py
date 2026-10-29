import json
import uuid
from datetime import datetime, timedelta, timezone


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Queue:
    """DB-backed replacement for a Cloudflare Queue.

    Keeps the exact ``send(message, delaySeconds=)`` call shape the app already
    uses, and delays are stored as ``available_at`` instead of a broker's
    visibility timeout.
    """

    def __init__(self, db, name: str, max_attempts: int = 4):
        self.db = db
        self.name = name
        self.max_attempts = max_attempts

    async def send(self, message, delaySeconds: int = 0) -> None:
        body = message if isinstance(message, str) else json.dumps(message, default=str)
        available_at = (datetime.now(timezone.utc) + timedelta(seconds=max(delaySeconds or 0, 0))).isoformat()
        await self.db.prepare(
            """
            INSERT INTO queue_messages (id, queue, body, available_at, attempts, created_at)
            VALUES (?, ?, ?, ?, 0, ?)
            """
        ).bind(f"qm_{uuid.uuid4().hex}", self.name, body, available_at, _now()).run()

    async def receive(self, limit: int = 20) -> list[dict]:
        """Claim due messages atomically; a DELETE that wins the row is the claim."""
        now = _now()
        rows = await self.db.prepare(
            """
            SELECT id, body, attempts FROM queue_messages
            WHERE queue = ? AND available_at <= ?
            ORDER BY available_at LIMIT ?
            """
        ).bind(self.name, now, limit).all()

        claimed: list[dict] = []
        for row in rows:
            res = await self.db.prepare(
                "DELETE FROM queue_messages WHERE id = ? AND available_at <= ?"
            ).bind(row["id"], now).run()
            if res.meta.changes == 1:
                claimed.append({"body": row["body"], "attempts": int(row["attempts"] or 0)})
        return claimed

    async def retry(self, body: str, attempts: int) -> bool:
        """Requeue a failed message with backoff. Returns False once exhausted."""
        if attempts >= self.max_attempts:
            return False
        delay = min(5 * (2 ** attempts), 300)
        available_at = (datetime.now(timezone.utc) + timedelta(seconds=delay)).isoformat()
        await self.db.prepare(
            """
            INSERT INTO queue_messages (id, queue, body, available_at, attempts, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """
        ).bind(
            f"qm_{uuid.uuid4().hex}",
            self.name,
            body,
            available_at,
            attempts + 1,
            _now(),
        ).run()
        return True

    async def size(self) -> int:
        row = await self.db.prepare(
            "SELECT COUNT(*) AS n FROM queue_messages WHERE queue = ?"
        ).bind(self.name).first()
        return int(row["n"] if row else 0)
