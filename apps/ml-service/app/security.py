from __future__ import annotations

import secrets

from fastapi import HTTPException, Request, status


async def verify_token(request: Request) -> None:
    """Optional shared-secret auth for internal service-to-service calls."""

    settings = request.app.state.settings
    expected = settings.internal_token
    if not expected:
        return

    authorization = request.headers.get("authorization", "")
    token = (
        authorization[7:].strip()
        if authorization.lower().startswith("bearer ")
        else request.headers.get("x-internal-token", "").strip()
    )
    if not token or not secrets.compare_digest(token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal service token",
            headers={"WWW-Authenticate": "Bearer"},
        )
