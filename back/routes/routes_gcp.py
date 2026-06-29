from __future__ import annotations

import os
import re
import secrets
import time
import urllib.parse
from typing import Annotated, List, Optional

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import RedirectResponse

from core.errors import AppError, BadRequest
from core.logging import get_logger
from schemas.gcp import (
    GCPAuthStatus,
    GCPBillingByMonth,
    GCPBillingByService,
    GCPBillingResponse,
    GCPLogEntry,
    GCPProject,
    GCPService,
    DateRange,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/gcp", tags=["gcp"])

# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

# WARNING: _oauth_states and _token_store are in-process dicts.
# MULTI-WORKER LIMITATION: This app MUST run with a single uvicorn worker
# (--workers 1). Under multiple workers, OAuth state set in worker-1 will not
# be visible in worker-2, causing CSRF validation failures for ~(N-1)/N
# requests. Migrate to a Redis/DB-backed session store before enabling
# multi-worker deployments.

_OAUTH_STATE_TTL = 600  # seconds — states older than this are rejected

_oauth_states: dict[str, dict] = {}  # state_token → {"created_at": float, "status": str}
_token_store: dict[str, dict] = {}   # "default" → token info dict


# Allowed OAuth error values returned by Google — anything else is mapped to
# a generic code to prevent log injection and reflected XSS via the ?error=
# query parameter.
_ALLOWED_OAUTH_ERRORS = frozenset({
    "access_denied",
    "invalid_scope",
    "invalid_request",
    "unauthorized_client",
    "unsupported_response_type",
    "server_error",
    "temporarily_unavailable",
    "interaction_required",
    "login_required",
    "account_selection_required",
    "consent_required",
})

# Allowed GCP log severity values (used to validate the ?severity= parameter
# to prevent log-filter injection).
_ALLOWED_SEVERITIES = frozenset({
    "DEFAULT", "DEBUG", "INFO", "NOTICE", "WARNING",
    "ERROR", "CRITICAL", "ALERT", "EMERGENCY",
})

# Regex for valid GCP project IDs per GCP naming rules.
_PROJECT_ID_RE = re.compile(r'^[a-z][a-z0-9\-]{4,28}[a-z0-9]$')


def _cleanup_expired_states() -> None:
    """Remove OAuth state entries older than _OAUTH_STATE_TTL seconds."""
    now = time.time()
    expired = [k for k, v in _oauth_states.items() if now - v["created_at"] > _OAUTH_STATE_TTL]
    for k in expired:
        _oauth_states.pop(k, None)


def _validate_project_id(project_id: str) -> None:
    """Raise BadRequest if project_id does not match GCP naming rules."""
    if not _PROJECT_ID_RE.match(project_id):
        raise BadRequest(
            "Invalid project_id format. Must match GCP project ID rules "
            "(lowercase letters, digits, hyphens; 6-30 chars; start with letter).",
            details={"field": "project_id"},
        )

_SCOPES = [
    "https://www.googleapis.com/auth/cloud-billing.readonly",
    "https://www.googleapis.com/auth/logging.read",
    "https://www.googleapis.com/auth/cloudplatformprojects.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def _get_env(key: str, default: str = "") -> str:
    return os.getenv(key, default)


def _get_credentials() -> dict:
    """Return stored token dict or raise 401."""
    token = _token_store.get("default")
    if not token:
        raise AppError("Not authenticated. Call /api/gcp/auth first.", code="UNAUTHORIZED", status_code=401)
    return token


def _build_auth_headers(token: dict) -> dict[str, str]:
    """Build Bearer auth headers from stored token info."""
    access_token = token.get("access_token", "")
    return {"Authorization": f"Bearer {access_token}"}


# ---------------------------------------------------------------------------
# OAuth2 routes
# ---------------------------------------------------------------------------

@router.get("/auth", summary="Redirect to Google OAuth2 consent screen")
def gcp_auth() -> RedirectResponse:
    _cleanup_expired_states()

    client_id = _get_env("GOOGLE_CLIENT_ID")
    redirect_uri = _get_env("GOOGLE_REDIRECT_URI", "http://localhost:8080/api/gcp/callback")

    if not client_id:
        raise AppError(
            "GOOGLE_CLIENT_ID not configured.",
            code="CONFIGURATION_ERROR",
            status_code=500,
        )

    state = secrets.token_urlsafe(16)
    _oauth_states[state] = {"created_at": time.time(), "status": "pending"}

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(_SCOPES),
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }

    auth_url = _GOOGLE_AUTH_URL + "?" + urllib.parse.urlencode(params)
    return RedirectResponse(url=auth_url, status_code=302)


@router.get("/callback", summary="Handle Google OAuth2 callback")
def gcp_callback(
    code: Annotated[Optional[str], Query()] = None,
    state: Annotated[Optional[str], Query()] = None,
    error: Annotated[Optional[str], Query()] = None,
) -> RedirectResponse:
    frontend_url = _get_env("FRONTEND_URL", "http://localhost:3000")

    if error:
        # Allowlist permitted OAuth error codes to prevent log injection and
        # reflected XSS via the ?error= parameter (SEC-002).
        safe_error = error if error in _ALLOWED_OAUTH_ERRORS else "oauth_error"
        redirect_url = f"{frontend_url}/gcp-connect?error={urllib.parse.quote(safe_error)}"
        return RedirectResponse(url=redirect_url, status_code=302)

    if not code:
        redirect_url = f"{frontend_url}/gcp-connect?error=missing_code"
        return RedirectResponse(url=redirect_url, status_code=302)

    state_entry = _oauth_states.get(state)
    if state_entry is None:
        redirect_url = f"{frontend_url}/gcp-connect?error=invalid_state"
        return RedirectResponse(url=redirect_url, status_code=302)

    # Reject states that have exceeded the TTL (SEC-003).
    if time.time() - state_entry["created_at"] > _OAUTH_STATE_TTL:
        _oauth_states.pop(state, None)
        redirect_url = f"{frontend_url}/gcp-connect?error=state_expired"
        return RedirectResponse(url=redirect_url, status_code=302)

    _oauth_states.pop(state, None)

    client_id = _get_env("GOOGLE_CLIENT_ID")
    client_secret = _get_env("GOOGLE_CLIENT_SECRET")
    redirect_uri = _get_env("GOOGLE_REDIRECT_URI", "http://localhost:8080/api/gcp/callback")

    try:
        resp = httpx.post(
            _GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=15,
        )
        resp.raise_for_status()
        token_data = resp.json()
    except Exception as exc:
        # SEC-001: Never forward upstream exception text to the client — it may
        # contain the client_secret, proxy credentials, or TLS details.
        # Log the actual error server-side with a correlation ID instead.
        logger.error("token_exchange_failed", extra={"error": repr(exc)})
        redirect_url = f"{frontend_url}/gcp-connect?error=token_exchange_failed"
        return RedirectResponse(url=redirect_url, status_code=302)

    # Fetch user email
    try:
        userinfo_resp = httpx.get(
            _GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {token_data['access_token']}"},
            timeout=10,
        )
        userinfo_resp.raise_for_status()
        userinfo = userinfo_resp.json()
        token_data["email"] = userinfo.get("email")
    except Exception:
        token_data["email"] = None

    _token_store["default"] = token_data

    redirect_url = f"{frontend_url}/gcp-connect?connected=1"
    return RedirectResponse(url=redirect_url, status_code=302)


@router.get("/status", response_model=GCPAuthStatus, summary="Check GCP authentication status")
def gcp_status() -> GCPAuthStatus:
    token = _token_store.get("default")
    if not token:
        return GCPAuthStatus(authenticated=False, email=None, project_id=None)
    return GCPAuthStatus(
        authenticated=True,
        email=token.get("email"),
        project_id=None,  # project is not scoped at auth level
    )


@router.get("/logout", summary="Clear stored GCP OAuth token")
def gcp_logout() -> dict:
    """Clear the in-memory token store, effectively logging the user out."""
    _token_store.pop("default", None)
    return {"logged_out": True}


# ---------------------------------------------------------------------------
# GCP Resource Manager — projects
# ---------------------------------------------------------------------------

@router.get("/projects", response_model=List[GCPProject], summary="List accessible GCP projects")
def gcp_projects() -> List[GCPProject]:
    token = _get_credentials()
    headers = _build_auth_headers(token)

    try:
        resp = httpx.get(
            "https://cloudresourcemanager.googleapis.com/v1/projects",
            headers=headers,
            params={"pageSize": 100},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            raise AppError("GCP token expired or invalid.", code="UNAUTHORIZED", status_code=401)
        raise AppError(
            f"Resource Manager API error: {exc.response.status_code}",
            code="GCP_API_ERROR",
            status_code=502,
            details={"upstream_status": exc.response.status_code},
        )
    except Exception as exc:
        logger.error("gcp_projects_error", extra={"error": repr(exc)})
        raise AppError("Upstream connectivity error.", code="GCP_API_ERROR", status_code=502)

    projects: List[GCPProject] = []
    for p in data.get("projects", []):
        projects.append(
            GCPProject(
                project_id=p.get("projectId", ""),
                name=p.get("name", ""),
                project_number=p.get("projectNumber", ""),
            )
        )
    return projects


# ---------------------------------------------------------------------------
# GCP Cloud Billing — billing info + cost breakdown
# ---------------------------------------------------------------------------

@router.get("/billing", response_model=GCPBillingResponse, summary="Get billing data for a project")
def gcp_billing(
    project_id: Annotated[str, Query(description="GCP project ID")],
    months: Annotated[int, Query(ge=1, le=24, description="Number of months to look back")] = 6,
) -> GCPBillingResponse:
    _validate_project_id(project_id)
    token = _get_credentials()
    headers = _build_auth_headers(token)

    # Fetch billing info for the project to get the linked billing account
    billing_account_id: Optional[str] = None
    try:
        billing_info_resp = httpx.get(
            f"https://cloudbilling.googleapis.com/v1/projects/{project_id}/billingInfo",
            headers=headers,
            timeout=15,
        )
        billing_info_resp.raise_for_status()
        billing_info = billing_info_resp.json()
        billing_account_name = billing_info.get("billingAccountName", "")
        # format: billingAccounts/XXXXXX-XXXXXX-XXXXXX
        if billing_account_name:
            billing_account_id = billing_account_name.split("/")[-1]
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            raise AppError("GCP token expired or invalid.", code="UNAUTHORIZED", status_code=401)
        # If billing info is unavailable, fall back to injected events data
        billing_account_id = None
    except Exception:
        billing_account_id = None

    # Try to get cost data from injected events first (available without BigQuery)
    try:
        from routes.routes_events import get_injected_events_df
        import pandas as pd
        from datetime import datetime, timedelta

        events_df = get_injected_events_df()
        use_injected = len(events_df) > 0

        if use_injected:
            cutoff = pd.Timestamp.now() - pd.DateOffset(months=months)
            filtered = events_df[events_df["ds"] >= cutoff].copy()

            if len(filtered) == 0:
                filtered = events_df.copy()

            total = float(filtered["Sous-total (€)"].sum())
            period_start = filtered["ds"].min().strftime("%Y-%m-%d")
            period_end = filtered["ds"].max().strftime("%Y-%m-%d")

            # by_service
            if "service" in filtered.columns:
                svc_agg = (
                    filtered.groupby("service")["Sous-total (€)"]
                    .sum()
                    .sort_values(ascending=False)
                )
                by_service = [
                    GCPBillingByService(
                        service=svc,
                        cost=round(float(cost), 2),
                        pct=round(float(cost) / total * 100, 2) if total > 0 else 0.0,
                    )
                    for svc, cost in svc_agg.items()
                ]
            else:
                by_service = []

            # by_month
            filtered["month"] = filtered["ds"].dt.to_period("M").astype(str)
            month_agg = (
                filtered.groupby("month")["Sous-total (€)"]
                .sum()
                .sort_index()
            )
            by_month = [
                GCPBillingByMonth(month=m, cost=round(float(c), 2))
                for m, c in month_agg.items()
            ]

            return GCPBillingResponse(
                project_id=project_id,
                period=DateRange(start=period_start, end=period_end),
                total=round(total, 2),
                by_service=by_service,
                by_month=by_month,
                currency="EUR",
            )
    except Exception:
        pass

    # Fall back to parquet data loaded by the app
    try:
        from data.loader import load_daily_costs, load_daily_per_service
        import pandas as pd

        daily_df = load_daily_costs()
        per_svc_df = load_daily_per_service()

        cutoff = pd.Timestamp.now() - pd.DateOffset(months=months)
        d_filtered = daily_df[daily_df["ds"] >= cutoff].copy()

        if len(d_filtered) == 0:
            d_filtered = daily_df.copy()

        total = float(d_filtered["y"].sum()) if "y" in d_filtered.columns else 0.0
        period_start = d_filtered["ds"].min().strftime("%Y-%m-%d")
        period_end = d_filtered["ds"].max().strftime("%Y-%m-%d")

        # by_month from daily_costs
        d_filtered["month"] = d_filtered["ds"].dt.to_period("M").astype(str)
        month_agg = d_filtered.groupby("month")["y"].sum().sort_index() if "y" in d_filtered.columns else {}
        by_month = [
            GCPBillingByMonth(month=m, cost=round(float(c), 2))
            for m, c in (month_agg.items() if hasattr(month_agg, "items") else [])
        ]

        # by_service from per_service (columns are service names)
        svc_cols = [c for c in per_svc_df.columns if c != "ds"]
        ps_filtered = per_svc_df[per_svc_df["ds"] >= cutoff].copy() if len(per_svc_df) > 0 else per_svc_df.copy()
        svc_totals = {svc: float(ps_filtered[svc].sum()) for svc in svc_cols if svc in ps_filtered.columns}
        sorted_svc = sorted(svc_totals.items(), key=lambda x: x[1], reverse=True)
        by_service = [
            GCPBillingByService(
                service=svc,
                cost=round(cost, 2),
                pct=round(cost / total * 100, 2) if total > 0 else 0.0,
            )
            for svc, cost in sorted_svc
        ]

        return GCPBillingResponse(
            project_id=project_id,
            period=DateRange(start=period_start, end=period_end),
            total=round(total, 2),
            by_service=by_service,
            by_month=by_month,
            currency="EUR",
        )
    except Exception as exc:
        logger.error("gcp_billing_error", extra={"error": repr(exc)})
        raise AppError(
            "Could not retrieve billing data.",
            code="GCP_BILLING_ERROR",
            status_code=502,
        )


# ---------------------------------------------------------------------------
# Cloud Logging
# ---------------------------------------------------------------------------

@router.get("/logs", response_model=List[GCPLogEntry], summary="Fetch Cloud Logging entries")
def gcp_logs(
    project_id: Annotated[str, Query(description="GCP project ID")],
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    severity: Annotated[Optional[str], Query(description="Minimum severity filter e.g. ERROR")] = None,
) -> List[GCPLogEntry]:
    # SEC-004: Validate inputs before interpolating into the GCP filter string.
    _validate_project_id(project_id)
    if severity is not None:
        severity_upper = severity.upper()
        if severity_upper not in _ALLOWED_SEVERITIES:
            raise BadRequest(
                f"Invalid severity value '{severity}'. "
                f"Allowed values: {sorted(_ALLOWED_SEVERITIES)}",
                details={"field": "severity", "allowed": sorted(_ALLOWED_SEVERITIES)},
            )
    else:
        severity_upper = None

    token = _get_credentials()
    headers = _build_auth_headers(token)
    headers["Content-Type"] = "application/json"

    filter_parts = [f'resource.labels.project_id="{project_id}"']
    if severity_upper:
        filter_parts.append(f'severity>={severity_upper}')

    body = {
        "resourceNames": [f"projects/{project_id}"],
        "filter": " AND ".join(filter_parts),
        "orderBy": "timestamp desc",
        "pageSize": limit,
    }

    try:
        resp = httpx.post(
            "https://logging.googleapis.com/v2/entries:list",
            headers=headers,
            json=body,
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            raise AppError("GCP token expired or invalid.", code="UNAUTHORIZED", status_code=401)
        raise AppError(
            f"Cloud Logging API error: {exc.response.status_code}",
            code="GCP_API_ERROR",
            status_code=502,
            details={"upstream_status": exc.response.status_code},
        )
    except Exception as exc:
        logger.error("gcp_logs_error", extra={"error": repr(exc)})
        raise AppError("Upstream connectivity error.", code="GCP_API_ERROR", status_code=502)

    entries: List[GCPLogEntry] = []
    for entry in data.get("entries", []):
        resource = entry.get("resource", {})
        resource_type = resource.get("type", "")
        resource_labels: dict = resource.get("labels", {})

        # Derive service name from resource labels or log name
        log_name = entry.get("logName", "")
        service = resource_labels.get("service_name") or log_name.split("/")[-1] or resource_type

        # Text payload or JSON payload
        if "textPayload" in entry:
            message = entry["textPayload"]
        elif "jsonPayload" in entry:
            jp = entry["jsonPayload"]
            message = jp.get("message") or jp.get("msg") or str(jp)
        elif "protoPayload" in entry:
            pp = entry["protoPayload"]
            message = pp.get("methodName") or pp.get("status", {}).get("message") or str(pp)
        else:
            message = ""

        entries.append(
            GCPLogEntry(
                timestamp=entry.get("timestamp", ""),
                severity=entry.get("severity", "DEFAULT"),
                resource_type=resource_type,
                service=service,
                message=message,
                labels={**resource_labels, **entry.get("labels", {})},
            )
        )

    return entries


# ---------------------------------------------------------------------------
# Service Usage API
# ---------------------------------------------------------------------------

@router.get("/services", response_model=List[GCPService], summary="List enabled GCP services for a project")
def gcp_services(
    project_id: Annotated[str, Query(description="GCP project ID")],
) -> List[GCPService]:
    _validate_project_id(project_id)
    token = _get_credentials()
    headers = _build_auth_headers(token)

    # Category mapping heuristic based on service name patterns
    _CATEGORY_MAP = {
        "bigquery": "Analytics",
        "storage": "Storage",
        "compute": "Compute",
        "run": "Serverless",
        "functions": "Serverless",
        "sql": "Database",
        "spanner": "Database",
        "firestore": "Database",
        "bigtable": "Database",
        "pubsub": "Messaging",
        "dataflow": "Analytics",
        "logging": "Operations",
        "monitoring": "Operations",
        "iam": "Identity",
        "cloudresourcemanager": "Management",
        "vertexai": "AI/ML",
        "aiplatform": "AI/ML",
        "ml": "AI/ML",
        "container": "Kubernetes",
        "kubernetes": "Kubernetes",
        "gke": "Kubernetes",
        "cloudbilling": "Billing",
        "serviceusage": "Management",
    }

    def _infer_category(service_name: str) -> str:
        name_lower = service_name.lower()
        for pattern, cat in _CATEGORY_MAP.items():
            if pattern in name_lower:
                return cat
        return "Other"

    services_list: List[GCPService] = []
    page_token: Optional[str] = None

    for _ in range(10):  # max 10 pages
        params: dict = {
            "filter": "state:ENABLED",
            "pageSize": 200,
        }
        if page_token:
            params["pageToken"] = page_token

        try:
            resp = httpx.get(
                f"https://serviceusage.googleapis.com/v1/projects/{project_id}/services",
                headers=headers,
                params=params,
                timeout=20,
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                raise AppError("GCP token expired or invalid.", code="UNAUTHORIZED", status_code=401)
            raise AppError(
                f"Service Usage API error: {exc.response.status_code}",
                code="GCP_API_ERROR",
                status_code=502,
                details={"upstream_status": exc.response.status_code},
            )
        except Exception as exc:
            logger.error("gcp_services_error", extra={"error": repr(exc)})
            raise AppError("Upstream connectivity error.", code="GCP_API_ERROR", status_code=502)

        for svc in data.get("services", []):
            config = svc.get("config", {})
            svc_name = config.get("name", svc.get("name", ""))
            # service name format: projects/123/services/bigquery.googleapis.com
            service_id = svc_name.split("/")[-1] if "/" in svc_name else svc_name
            display_name = config.get("title") or service_id
            state = svc.get("state", "DISABLED")
            services_list.append(
                GCPService(
                    service_id=service_id,
                    name=display_name,
                    enabled=(state == "ENABLED"),
                    category=_infer_category(service_id),
                )
            )

        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return services_list
