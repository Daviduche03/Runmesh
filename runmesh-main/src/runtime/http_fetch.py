"""Drop-in for the Workers ``fetch`` the app imported from ``workers``.

Call sites use ``await fetch(url, method=, headers=, body=)`` and then read
``.status`` / ``await .text()``, which is the shape ``httpx`` adapts to cheaply.
"""

from typing import Any, Mapping, Optional

import httpx

_DEFAULT_TIMEOUT = 30.0
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT, follow_redirects=True)
    return _client


class Response:
    def __init__(self, response: httpx.Response):
        self._response = response
        self.status = response.status_code
        self.ok = response.is_success
        self.headers = response.headers

    async def text(self) -> str:
        return self._response.text

    async def json(self) -> Any:
        return self._response.json()

    async def body(self) -> bytes:
        return self._response.content


async def fetch(
    url: str,
    method: str = "GET",
    headers: Optional[Mapping[str, str]] = None,
    body: Any = None,
    **kwargs: Any,
) -> Response:
    return Response(
        await _get_client().request(
            method=method,
            url=url,
            headers=dict(headers or {}),
            content=body,
            **kwargs,
        )
    )


async def close() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None
