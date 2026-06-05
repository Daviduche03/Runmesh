from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from utils.responses import error_from_status


async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, list):
        message = "; ".join(
            f"{'.'.join(str(loc) for loc in item.get('loc', []))}: {item.get('msg', '')}"
            for item in detail
            if isinstance(item, dict)
        ) or "Validation failed"
    elif isinstance(detail, dict):
        message = detail.get("message", str(detail))
    else:
        message = str(detail)
    return JSONResponse(
        status_code=exc.status_code,
        content=error_from_status(exc.status_code, message),
    )


async def validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    messages = []
    for item in exc.errors():
        loc = ".".join(str(part) for part in item.get("loc", []) if part != "body")
        messages.append(f"{loc}: {item.get('msg', 'invalid')}" if loc else item.get("msg", "invalid"))
    return JSONResponse(
        status_code=422,
        content=error_from_status(422, "; ".join(messages) or "Validation failed"),
    )
