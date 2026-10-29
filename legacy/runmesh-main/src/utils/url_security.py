"""Outbound URL validation (SSRF protection) for user-supplied fetch targets.

Blocks non-http(s) schemes, credential-embedded URLs, localhost names, and
private/loopback/link-local/reserved IP literals. Note: hostnames are not
DNS-resolved here (no socket access in the Workers runtime), so a public
hostname that resolves to a private IP cannot be detected at this layer.
"""
import ipaddress
from urllib.parse import urlparse

from fastapi import HTTPException

_BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    "metadata",
    "metadata.google.internal",
}

_BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home", ".corp")


def _is_blocked_ip(ip: ipaddress._BaseAddress) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def validate_outbound_url(url: str, field_name: str = "url") -> str:
    """Validate a user-supplied outbound URL. Returns the cleaned URL or raises 400."""
    value = (url or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail=f"{field_name} is required")
    try:
        parsed = urlparse(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field_name} is invalid")

    if parsed.scheme not in ("https", "http"):
        raise HTTPException(status_code=400, detail=f"{field_name} must use http or https")
    if not parsed.netloc or not parsed.hostname:
        raise HTTPException(status_code=400, detail=f"{field_name} is invalid")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail=f"{field_name} must not contain credentials")

    host = parsed.hostname.strip().lower().rstrip(".")

    # Strip IPv6 brackets for the IP literal check
    ip_text = host[1:-1] if host.startswith("[") and host.endswith("]") else host
    try:
        ip = ipaddress.ip_address(ip_text)
    except ValueError:
        ip = None
    if ip is not None:
        if _is_blocked_ip(ip):
            raise HTTPException(
                status_code=400,
                detail=f"{field_name} must not target a private or reserved address",
            )
        return value

    if host in _BLOCKED_HOSTNAMES or any(host.endswith(suffix) for suffix in _BLOCKED_SUFFIXES):
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must not target a local or internal hostname",
        )
    return value


def is_outbound_url_allowed(url: str) -> bool:
    """Non-raising variant for call sites that handle the failure themselves."""
    try:
        validate_outbound_url(url)
        return True
    except HTTPException:
        return False
