from typing import Any, Optional


def success(
    data: Any = None,
    message: Optional[str] = None,
    meta: Optional[dict] = None,
) -> dict:
    body: dict = {"ok": True, "data": data}
    if message is not None:
        body["message"] = message
    if meta is not None:
        body["meta"] = meta
    return body


def error(code: str, message: str) -> dict:
    return {"ok": False, "error": {"code": code, "message": message}}


def error_from_status(status_code: int, message: str) -> dict:
    codes = {
        400: "bad_request",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        422: "validation_error",
        500: "internal_error",
    }
    return error(codes.get(status_code, "error"), message)
