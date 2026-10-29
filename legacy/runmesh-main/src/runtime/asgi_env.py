class EnvMiddleware:
    """Puts the runtime ``env`` into ``scope["env"]`` before the app handles it.

    The Workers ASGI bridge used to do this injection; every route reads the
    env the same way, so no handler changes are needed here.
    """

    def __init__(self, app, env):
        self.app = app
        self.env = env

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            scope["env"] = self.env
        await self.app(scope, receive, send)
