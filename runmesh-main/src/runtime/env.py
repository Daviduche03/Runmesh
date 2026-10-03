import os


def _env(name: str) -> str:
    return os.environ.get(name, "")


class Env:
    """The `env` object handed to route handlers via ``request.scope["env"]``.

    Mirrors the Cloudflare bindings the app used to receive so the 98 existing
    ``request.scope["env"]`` reads keep working unchanged.
    """

    def __init__(self, db, task_queue, webhook_queue):
        self.DB = db
        self.TASK_QUEUE = task_queue
        self.WEBHOOK_QUEUE = webhook_queue
        self.JWT_SECRET = _env("JWT_SECRET")
        self.PUBLIC_URL = _env("PUBLIC_URL")
        self.FRONTEND_URL = _env("FRONTEND_URL")
        self.GITHUB_CLIENT_ID = _env("GITHUB_CLIENT_ID")
        self.GITHUB_CLIENT_SECRET = _env("GITHUB_CLIENT_SECRET")
        self.GOOGLE_CONNECT_CLIENT_ID = _env("GOOGLE_CONNECT_CLIENT_ID")
        self.GOOGLE_CONNECT_CLIENT_SECRET = _env("GOOGLE_CONNECT_CLIENT_SECRET")
        self.RESEND_API_KEY = _env("RESEND_API_KEY")
