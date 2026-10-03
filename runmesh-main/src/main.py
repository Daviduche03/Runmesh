"""VPS entrypoint: replaces the Cloudflare `Default` worker entrypoints.

    DB_PATH=runmesh.db PUBLIC_URL=https://api.example.com \
    JWT_SECRET=... uv run python src/main.py
"""

import asyncio
import os

import uvicorn

from entry import app
from runtime import http_fetch, migrate, runner
from runtime.asgi_env import EnvMiddleware
from runtime.env import Env
from runtime.queue import Queue
from runtime.sqlite_db import Database

DB_PATH = os.environ.get("DB_PATH", "runmesh.db")
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8787"))
LOG_LEVEL = os.environ.get("LOG_LEVEL", "info")
SWEEP_INTERVAL = float(os.environ.get("SWEEP_INTERVAL_SECONDS", "5"))
QUEUE_POLL_INTERVAL = float(os.environ.get("QUEUE_POLL_INTERVAL_SECONDS", "1"))


async def build_env() -> Env:
    await migrate.apply(DB_PATH, os.environ.get("MIGRATIONS_DIR") or None)
    db = await Database(DB_PATH).open()
    return Env(db, Queue(db, runner.TASK_QUEUE_NAME), Queue(db, runner.WEBHOOK_QUEUE_NAME))


async def serve() -> None:
    env = await build_env()
    asgi_app = EnvMiddleware(app, env)
    tasks = await runner.start(env, poll_interval=QUEUE_POLL_INTERVAL, sweep_interval=SWEEP_INTERVAL)
    config = uvicorn.Config(asgi_app, host=HOST, port=PORT, log_level=LOG_LEVEL, access_log=False)
    server = uvicorn.Server(config)
    try:
        await server.serve()
    finally:
        await runner.stop(tasks)
        await env.DB.close()
        await http_fetch.close()


def main() -> None:
    asyncio.run(serve())


if __name__ == "__main__":
    main()
