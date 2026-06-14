from enum import Enum

from fastapi import HTTPException

from utils.types import ConnectSessionMode


class ConnectProvider(str, Enum):
    GOOGLE = "google"
    SLACK = "slack"
    META = "meta"


CONNECT_PROVIDER_SCOPES: dict[ConnectProvider, dict[str, str]] = {
    ConnectProvider.GOOGLE: {
        "gmail.readonly": "https://www.googleapis.com/auth/gmail.readonly",
        "gmail.send": "https://www.googleapis.com/auth/gmail.send",
        "gmail.modify": "https://www.googleapis.com/auth/gmail.modify",
        "gmail.compose": "https://www.googleapis.com/auth/gmail.compose",
        "gmail.labels": "https://www.googleapis.com/auth/gmail.labels",
        "youtube.readonly": "https://www.googleapis.com/auth/youtube.readonly",
        "youtube.upload": "https://www.googleapis.com/auth/youtube.upload",
        "drive.readonly": "https://www.googleapis.com/auth/drive.readonly",
        "drive.file": "https://www.googleapis.com/auth/drive.file",
        "drive.metadata.readonly": "https://www.googleapis.com/auth/drive.metadata.readonly",
    },
    ConnectProvider.SLACK: {
        "channels:read": "channels:read",
        "channels:history": "channels:history",
        "chat:write": "chat:write",
        "users:read": "users:read",
        "users:read.email": "users:read.email",
    },
    ConnectProvider.META: {
        "pages_show_list": "pages_show_list",
        "pages_read_engagement": "pages_read_engagement",
        "pages_manage_posts": "pages_manage_posts",
        "instagram_basic": "instagram_basic",
        "instagram_content_publish": "instagram_content_publish",
    },
}

OAUTH_ENABLED_PROVIDERS: set[ConnectProvider] = {ConnectProvider.GOOGLE}


def parse_connect_provider(value: str | None) -> ConnectProvider:
    if not value or not value.strip():
        raise HTTPException(status_code=400, detail="provider is required")
    normalized = value.strip().lower()
    try:
        return ConnectProvider(normalized)
    except ValueError:
        allowed = ", ".join(provider.value for provider in ConnectProvider)
        raise HTTPException(status_code=400, detail=f"unsupported provider; allowed: {allowed}")


def provider_scope_aliases(provider: ConnectProvider) -> dict[str, str]:
    return CONNECT_PROVIDER_SCOPES.get(provider, {})


def validate_provider_allowed(
    provider: ConnectProvider,
    allowed_providers: list[str],
) -> None:
    if not allowed_providers:
        return
    allowed = {item.strip().lower() for item in allowed_providers if item.strip()}
    if provider.value not in allowed:
        raise HTTPException(status_code=400, detail="provider is not allowed for this app")


def normalize_requested_scopes(provider: ConnectProvider, scopes: list[str]) -> list[str]:
    aliases = provider_scope_aliases(provider)
    if not aliases:
        raise HTTPException(status_code=400, detail=f"no scopes configured for provider {provider.value}")
    cleaned: list[str] = []
    for scope in scopes:
        value = scope.strip()
        if not value:
            continue
        if value in aliases:
            cleaned.append(value)
            continue
        if value.startswith("https://") and value in aliases.values():
            for alias, remote in aliases.items():
                if remote == value:
                    cleaned.append(alias)
                    break
            continue
        raise HTTPException(
            status_code=400,
            detail=f"unknown scope '{value}' for provider {provider.value}",
        )
    return list(dict.fromkeys(cleaned))


def resolve_oauth_scopes(
    provider: ConnectProvider,
    mode: ConnectSessionMode,
    requested_scopes: list[str],
) -> list[str]:
    if provider not in OAUTH_ENABLED_PROVIDERS:
        raise HTTPException(status_code=501, detail=f"OAuth not enabled for provider {provider.value}")

    if provider == ConnectProvider.GOOGLE:
        aliases = provider_scope_aliases(provider)
        resolved: list[str] = []
        for scope in requested_scopes:
            resolved.append(aliases[scope])
        if not resolved:
            raise HTTPException(status_code=400, detail="at least one scope is required")
        return list(dict.fromkeys(resolved))

    raise HTTPException(status_code=501, detail=f"OAuth scope resolution not implemented for {provider.value}")


def oauth_needs_offline_access(provider: ConnectProvider, mode: ConnectSessionMode) -> bool:
    return mode == ConnectSessionMode.CONNECT and provider == ConnectProvider.GOOGLE


def list_providers_catalog() -> list[dict]:
    items: list[dict] = []
    for provider in ConnectProvider:
        aliases = provider_scope_aliases(provider)
        items.append({
            "id": provider.value,
            "scopes": sorted(aliases.keys()),
            "oauth_enabled": provider in OAUTH_ENABLED_PROVIDERS,
        })
    return items
