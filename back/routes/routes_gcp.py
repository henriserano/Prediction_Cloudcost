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
    GCPBillingAccount,
    GCPBillingByMonth,
    GCPBillingByService,
    GCPBillingResponse,
    GCPLogEntry,
    GCPProject,
    GCPService,
    DateRange,
)
from core.config import get_settings

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
    # Required by the Service Usage API (services.list). Without this scope
    # the OAuth token is rejected with 403 even if the user is Owner.
    "https://www.googleapis.com/auth/cloud-platform.read-only",
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


def _raise_gcp_upstream_error(exc: httpx.HTTPStatusError, api_name: str, project_id: Optional[str] = None) -> None:
    """Map a GCP HTTPStatusError onto the closest matching AppError.

    Preserves 401/403 so the client can act on them (re-auth vs. enable
    API / grant IAM role). Other upstream codes are surfaced as 502.
    """
    status = exc.response.status_code
    if status == 401:
        raise AppError("GCP token expired or invalid.", code="UNAUTHORIZED", status_code=401)

    # Extract the upstream error message when Google returned JSON — it usually
    # tells us exactly which permission is missing or which API is disabled.
    upstream_detail: Optional[str] = None
    try:
        body = exc.response.json()
        upstream_detail = body.get("error", {}).get("message")
    except Exception:
        upstream_detail = None

    if status == 403:
        hint = (
            f"{api_name} returned 403. Common causes: (1) the API is not "
            f"enabled on the project — enable it at "
            f"https://console.cloud.google.com/apis/library ; "
            f"(2) the signed-in user lacks the required IAM role."
        )
        raise AppError(
            hint,
            code="FORBIDDEN",
            status_code=403,
            details={
                "upstream_status": 403,
                "upstream_message": upstream_detail,
                "project_id": project_id,
                "api": api_name,
            },
        )

    raise AppError(
        f"{api_name} error: {status}",
        code="GCP_API_ERROR",
        status_code=502,
        details={"upstream_status": status, "upstream_message": upstream_detail},
    )


# ---------------------------------------------------------------------------
# OAuth2 routes
# ---------------------------------------------------------------------------

@router.get("/auth", summary="Redirect to Google OAuth2 consent screen")
def gcp_auth() -> RedirectResponse:
    _cleanup_expired_states()

    settings = get_settings()
    client_id = settings.google_client_id or _get_env("GOOGLE_CLIENT_ID")
    redirect_uri = settings.google_redirect_uri or _get_env(
        "GOOGLE_REDIRECT_URI", "http://localhost:8080/api/gcp/callback"
    )

    if not client_id:
        raise AppError(
            "GOOGLE_CLIENT_ID not configured. Set it in back/.env or export it "
            "before starting uvicorn.",
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
    settings = get_settings()
    frontend_url = settings.frontend_url or _get_env("FRONTEND_URL", "http://localhost:3000")

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

    client_id = settings.google_client_id or _get_env("GOOGLE_CLIENT_ID")
    client_secret = settings.google_client_secret or _get_env("GOOGLE_CLIENT_SECRET")
    redirect_uri = settings.google_redirect_uri or _get_env(
        "GOOGLE_REDIRECT_URI", "http://localhost:8080/api/gcp/callback"
    )

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
        _raise_gcp_upstream_error(exc, api_name="Resource Manager API")
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

def _fetch_billing_account_id(project_id: str, headers: dict[str, str]) -> Optional[str]:
    """Return the billing account ID linked to a project, or None on failure.

    Raises AppError(401) if the OAuth token is rejected — auth errors must not
    be silently swallowed as "no billing account".
    """
    try:
        resp = httpx.get(
            f"https://cloudbilling.googleapis.com/v1/projects/{project_id}/billingInfo",
            headers=headers,
            timeout=15,
        )
        resp.raise_for_status()
        billing_account_name = resp.json().get("billingAccountName", "")
        if billing_account_name:
            return billing_account_name.split("/")[-1]
        return None
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 401:
            raise AppError("GCP token expired or invalid.", code="UNAUTHORIZED", status_code=401)
        logger.warning(
            "gcp_billing_info_upstream_error",
            extra={"upstream_status": exc.response.status_code, "project_id": project_id},
        )
        return None
    except Exception as exc:
        logger.warning("gcp_billing_info_error", extra={"error": repr(exc), "project_id": project_id})
        return None


def _query_bigquery_billing_export(
    project_id: str, months: int
) -> Optional[GCPBillingResponse]:
    """Query the GCP Billing BigQuery Export for real cost data.

    Returns None when the export is not configured or the BigQuery client
    library is unavailable — the caller is expected to fall back.
    Only returns a GCPBillingResponse when real GCP data was retrieved.
    """
    settings = get_settings()
    bq_project = settings.gcp_billing_export_project
    bq_dataset = settings.gcp_billing_export_dataset
    bq_table = settings.gcp_billing_export_table
    if not (bq_project and bq_dataset and bq_table):
        return None

    try:
        from google.cloud import bigquery  # type: ignore
    except Exception:
        logger.info("bigquery_library_unavailable — install google-cloud-bigquery to enable real billing export queries")
        return None

    try:
        client = bigquery.Client(project=bq_project)
        table_fqn = f"`{bq_project}.{bq_dataset}.{bq_table}`"

        query = f"""
            SELECT
              DATE(usage_start_time) AS day,
              service.description AS service,
              SUM(cost) AS cost,
              currency
            FROM {table_fqn}
            WHERE project.id = @project_id
              AND usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @months MONTH)
            GROUP BY day, service, currency
            ORDER BY day
        """
        job = client.query(
            query,
            job_config=bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("project_id", "STRING", project_id),
                    bigquery.ScalarQueryParameter("months", "INT64", months),
                ]
            ),
        )
        import pandas as pd

        rows = [dict(r) for r in job.result()]
        if not rows:
            return None

        df = pd.DataFrame(rows)
        df["day"] = pd.to_datetime(df["day"])
        df["cost"] = df["cost"].astype(float)
        currency = df["currency"].dropna().iloc[0] if "currency" in df.columns and not df["currency"].dropna().empty else "EUR"

        total = float(df["cost"].sum())
        period_start = df["day"].min().strftime("%Y-%m-%d")
        period_end = df["day"].max().strftime("%Y-%m-%d")

        svc_agg = df.groupby("service")["cost"].sum().sort_values(ascending=False)
        by_service = [
            GCPBillingByService(
                service=str(svc),
                cost=round(float(cost), 2),
                pct=round(float(cost) / total * 100, 2) if total > 0 else 0.0,
            )
            for svc, cost in svc_agg.items()
        ]

        df["month"] = df["day"].dt.to_period("M").astype(str)
        month_agg = df.groupby("month")["cost"].sum().sort_index()
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
            currency=currency,
            source="bigquery_export",
        )
    except Exception as exc:
        logger.error("bigquery_billing_export_query_failed", extra={"error": repr(exc)})
        return None


def _billing_from_injected_events(project_id: str, months: int) -> Optional[GCPBillingResponse]:
    """Build a billing response from client-injected events, or None if empty."""
    try:
        from routes.routes_events import get_injected_events_df
        import pandas as pd

        events_df = get_injected_events_df()
        if len(events_df) == 0:
            return None

        cutoff = pd.Timestamp.now() - pd.DateOffset(months=months)
        filtered = events_df[events_df["ds"] >= cutoff].copy()
        if len(filtered) == 0:
            filtered = events_df.copy()

        total = float(filtered["Sous-total (€)"].sum())
        period_start = filtered["ds"].min().strftime("%Y-%m-%d")
        period_end = filtered["ds"].max().strftime("%Y-%m-%d")

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

        filtered["month"] = filtered["ds"].dt.to_period("M").astype(str)
        month_agg = filtered.groupby("month")["Sous-total (€)"].sum().sort_index()
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
            source="injected_events",
        )
    except Exception as exc:
        logger.warning("injected_events_read_failed", extra={"error": repr(exc)})
        return None


def _billing_from_parquet(project_id: str, months: int) -> GCPBillingResponse:
    """Last-resort fallback using bundled parquet demo data."""
    from data.loader import load_daily_costs, load_daily_per_service
    import pandas as pd

    daily_df = load_daily_costs()
    per_svc_df = load_daily_per_service()

    cutoff = pd.Timestamp.now() - pd.DateOffset(months=months)
    d_filtered = daily_df[daily_df["ds"] >= cutoff].copy() if len(daily_df) > 0 else daily_df.copy()

    if len(d_filtered) == 0:
        d_filtered = daily_df.copy()

    total = float(d_filtered["y"].sum()) if "y" in d_filtered.columns and len(d_filtered) > 0 else 0.0
    if len(d_filtered) > 0:
        period_start = d_filtered["ds"].min().strftime("%Y-%m-%d")
        period_end = d_filtered["ds"].max().strftime("%Y-%m-%d")
    else:
        period_start = period_end = ""

    if len(d_filtered) > 0 and "y" in d_filtered.columns:
        d_filtered["month"] = d_filtered["ds"].dt.to_period("M").astype(str)
        month_agg = d_filtered.groupby("month")["y"].sum().sort_index()
        by_month = [
            GCPBillingByMonth(month=m, cost=round(float(c), 2))
            for m, c in month_agg.items()
        ]
    else:
        by_month = []

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
        source="parquet_fallback",
    )


@router.get(
    "/billing-accounts",
    response_model=List[GCPBillingAccount],
    summary="List Cloud Billing accounts accessible with the current OAuth token",
)
def gcp_billing_accounts() -> List[GCPBillingAccount]:
    """Verify the OAuth token can read Cloud Billing by listing accounts.

    This is the fastest way to confirm the ``cloud-billing.readonly`` scope was
    granted and that the token still resolves against the Cloud Billing API.
    """
    token = _get_credentials()
    headers = _build_auth_headers(token)

    accounts: List[GCPBillingAccount] = []
    page_token: Optional[str] = None
    for _ in range(10):
        params: dict = {"pageSize": 200}
        if page_token:
            params["pageToken"] = page_token
        try:
            resp = httpx.get(
                "https://cloudbilling.googleapis.com/v1/billingAccounts",
                headers=headers,
                params=params,
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPStatusError as exc:
            _raise_gcp_upstream_error(exc, api_name="Cloud Billing API")
        except Exception as exc:
            logger.error("gcp_billing_accounts_error", extra={"error": repr(exc)})
            raise AppError("Upstream connectivity error.", code="GCP_API_ERROR", status_code=502)

        for acc in data.get("billingAccounts", []):
            name = acc.get("name", "")
            accounts.append(
                GCPBillingAccount(
                    name=name,
                    account_id=name.split("/")[-1] if name else "",
                    display_name=acc.get("displayName", ""),
                    open=bool(acc.get("open", False)),
                    master_billing_account=acc.get("masterBillingAccount") or None,
                )
            )
        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return accounts


@router.get("/billing", response_model=GCPBillingResponse, summary="Get billing data for a project")
def gcp_billing(
    project_id: Annotated[str, Query(description="GCP project ID")],
    months: Annotated[int, Query(ge=1, le=24, description="Number of months to look back")] = 6,
) -> GCPBillingResponse:
    """Return cost data for a project.

    Data source resolution order:
      1. BigQuery Billing Export (real GCP data) when configured.
      2. Client-injected events (via POST /api/events).
      3. Bundled parquet demo data.

    The response ``source`` field always reports which branch produced the
    numbers so the frontend can label the origin.
    """
    _validate_project_id(project_id)
    token = _get_credentials()
    headers = _build_auth_headers(token)

    billing_account_id = _fetch_billing_account_id(project_id, headers)

    bq_response = _query_bigquery_billing_export(project_id, months)
    if bq_response is not None:
        bq_response.billing_account_id = billing_account_id
        return bq_response

    injected_response = _billing_from_injected_events(project_id, months)
    if injected_response is not None:
        injected_response.billing_account_id = billing_account_id
        return injected_response

    try:
        fallback = _billing_from_parquet(project_id, months)
        fallback.billing_account_id = billing_account_id
        return fallback
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
        _raise_gcp_upstream_error(exc, api_name="Cloud Logging API", project_id=project_id)
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
            _raise_gcp_upstream_error(exc, api_name="Service Usage API", project_id=project_id)
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
