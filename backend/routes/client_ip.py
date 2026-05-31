"""
Shared client-IP resolution for rate limiting.

Security note:
    `X-Forwarded-For` is set by the client and can be spoofed. An attacker can
    rotate this header to appear as a different IP on every request, bypassing
    per-IP rate limits. We therefore only trust it when the deployment is
    explicitly known to sit behind a trusted reverse proxy (Render/Railway/Fly,
    nginx, etc.) via the TRUST_PROXY env var.

    - TRUST_PROXY truthy  → use the left-most X-Forwarded-For entry (real client
      as appended by the trusted proxy), falling back to the socket peer.
    - TRUST_PROXY falsy   → ignore the header entirely and use the socket peer
      (request.client.host), which cannot be spoofed.
"""

import os
from starlette.requests import Request

_TRUST_PROXY = os.getenv("TRUST_PROXY", "").strip().lower() in ("1", "true", "yes", "on")


def get_client_ip(request: Request) -> str:
    """Resolve the client IP for rate limiting, respecting TRUST_PROXY."""
    if _TRUST_PROXY:
        forwarded = request.headers.get("X-Forwarded-For", "")
        if forwarded:
            first = forwarded.split(",")[0].strip()
            if first:
                return first
    return request.client.host if request.client else "unknown"
