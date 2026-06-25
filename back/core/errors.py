from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Base application error."""

    def __init__(self, message: str, *, code: str = "APP_ERROR", status_code: int = 400, details: Any = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details


class BadRequest(AppError):
    def __init__(self, message: str = "Bad request", *, details: Any = None):
        super().__init__(message, code="BAD_REQUEST", status_code=400, details=details)


class Unauthorized(AppError):
    def __init__(self, message: str = "Unauthorized", *, details: Any = None):
        super().__init__(message, code="UNAUTHORIZED", status_code=401, details=details)


class Forbidden(AppError):
    def __init__(self, message: str = "Forbidden", *, details: Any = None):
        super().__init__(message, code="FORBIDDEN", status_code=403, details=details)


class NotFound(AppError):
    def __init__(self, message: str = "Not found", *, details: Any = None):
        super().__init__(message, code="NOT_FOUND", status_code=404, details=details)


class DependencyError(AppError):
    def __init__(self, message: str = "Missing/invalid dependency", *, details: Any = None):
        super().__init__(message, code="DEPENDENCY_ERROR", status_code=500, details=details)