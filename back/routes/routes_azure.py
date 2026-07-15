"""Azure Cost Management endpoints.

Mirror of ``routes_aws`` for Microsoft Azure. The caller unlocks their Service
Principal via ``PUT /api/credentials/azure`` (PIN-wrapped AES-GCM); we then
cache the ``ClientSecretCredential`` in memory and every ``/api/azure/*``
call scopes to that user.

Real functionality requires the ``azure-identity``, ``azure-mgmt-resource``
and ``azure-mgmt-costmanagement`` packages. Imports are lazy so the app
still starts if they are missing — ``/status`` reports the missing
dependency cleanly instead of crashing at import time.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query, Request

from analysis.service_taxonomy import categorize
from core.azure_session import get_user_azure
from core.errors import AppError, BadRequest
from core.logging import get_logger
from schemas.azure import (
    AzureAuthStatus,
    AzureBillingByDay,
    AzureBillingByMonth,
    AzureBillingByService,
    AzureBillingResponse,
    AzureSubscription,
    AzureSyncRequest,
    AzureSyncResponse,
)
from schemas.gcp import BillingEvent, DateRange, EventsIngestRequest

logger = get_logger(__name__)

router = APIRouter(prefix="/api/azure", tags=["azure"])


# ---------------------------------------------------------------------------
# Lazy Azure SDK imports
# ---------------------------------------------------------------------------


def _import_identity():
    """Return the azure-identity module, or raise a 500 AppError with guidance."""
    try:
        from azure.core.exceptions import (  # type: ignore
            ClientAuthenticationError,
            HttpResponseError,
        )
        from azure.identity import ClientSecretCredential  # type: ignore

        return ClientSecretCredential, ClientAuthenticationError, HttpResponseError
    except Exception as exc:
        logger.error("azure_identity_import_failed", extra={"error": repr(exc)})
        raise AppError(
            "azure-identity is not installed. Add "
            "'azure-identity>=1.17', 'azure-mgmt-resource>=23', "
            "'azure-mgmt-costmanagement>=4' to back/requirements.txt.",
            code="DEPENDENCY_ERROR",
            status_code=500,
        ) from exc


def _import_resource_client():
    try:
        from azure.mgmt.resource import SubscriptionClient  # type: ignore

        return SubscriptionClient
    except Exception as exc:
        logger.error("azure_mgmt_resource_import_failed", extra={"error": repr(exc)})
        raise AppError(
            "azure-mgmt-resource is not installed. Add it to back/requirements.txt.",
            code="DEPENDENCY_ERROR",
            status_code=500,
        ) from exc


def _import_cost_client():
    """Return the classes we actually use from azure-mgmt-costmanagement."""
    try:
        from azure.mgmt.costmanagement import CostManagementClient  # type: ignore
        from azure.mgmt.costmanagement.models import (  # type: ignore
            QueryAggregation,
            QueryDataset,
            QueryDefinition,
            QueryGrouping,
            QueryTimePeriod,
        )

        return (
            CostManagementClient,
            QueryAggregation,
            QueryDataset,
            QueryDefinition,
            QueryGrouping,
            QueryTimePeriod,
        )
    except Exception as exc:
        logger.error("azure_costmanagement_import_failed", extra={"error": repr(exc)})
        raise AppError(
            "azure-mgmt-costmanagement is not installed. Add it to back/requirements.txt.",
            code="DEPENDENCY_ERROR",
            status_code=500,
        ) from exc


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _entry_or_401(request: Request):
    """Return the cached Azure credential entry for the caller or raise 401."""
    from core.session import get_current_user_id

    user_id = get_current_user_id(request)
    entry = get_user_azure(user_id)
    if entry is None:
        raise AppError(
            "Azure credentials are locked. Unlock them via /api/credentials/azure "
            "or re-enter your PIN.",
            code="UNAUTHORIZED",
            status_code=401,
        )
    return entry


def _resolve_period(start: str | None, end: str | None, months_default: int = 6) -> tuple[str, str]:
    """Return (start, end) as ISO YYYY-MM-DD, defaulting to the last N months.

    Azure Cost Management treats the period ``to`` as inclusive — we do NOT
    add a day here (unlike Cost Explorer which is exclusive).
    """
    today = date.today()
    end_date = date.fromisoformat(end) if end else today
    if start:
        start_date = date.fromisoformat(start)
    else:
        start_date = today.replace(day=1) - timedelta(days=30 * (months_default - 1))
    if start_date > end_date:
        raise BadRequest(
            "start must be on or before end.",
            details={"start": start_date.isoformat(), "end": end_date.isoformat()},
        )
    return start_date.isoformat(), end_date.isoformat()


def _wrap_azure_exception(exc: Exception, resource: str) -> AppError:
    """Map Azure SDK exceptions onto AppError with a generic client message.

    SEC-017: Verbose upstream messages (e.g. "tenant not found" vs "invalid
    client_id") let an authenticated caller enumerate valid GUIDs. We log the
    real error server-side and hand back a single generic message per status
    class so tenant/client/subscription probing is not observable.
    """
    ClientAuthenticationError = _import_identity()[1]
    HttpResponseError = _import_identity()[2]

    # Always log the real error with correlation info; never surface it.
    logger.warning(
        "azure_sdk_error",
        extra={"resource": resource, "error": repr(exc)},
    )

    if isinstance(exc, ClientAuthenticationError):
        return AppError(
            "Azure authentication failed. Verify the stored Service Principal.",
            code="AZURE_AUTH_ERROR",
            status_code=401,
        )
    if isinstance(exc, HttpResponseError):
        status = getattr(exc, "status_code", None) or 502
        if status == 403:
            return AppError(
                "Azure denied access. The Service Principal is missing a required role.",
                code="AZURE_ACCESS_DENIED",
                status_code=403,
            )
        return AppError(
            "Upstream Azure error.",
            code="AZURE_API_ERROR",
            status_code=502 if status >= 500 else status,
        )
    return AppError(
        "Upstream Azure connectivity error.",
        code="AZURE_API_ERROR",
        status_code=502,
    )


# ---------------------------------------------------------------------------
# Auth status
# ---------------------------------------------------------------------------


@router.get(
    "/status", response_model=AzureAuthStatus, summary="Check Azure Service Principal via AAD"
)
def azure_status(request: Request) -> AzureAuthStatus:
    """Report whether the Service Principal in cache can obtain an AAD token.

    Never raises — returns ``authenticated=False`` with a ``detail`` message so
    the frontend can render a helpful connect prompt.
    """
    from core.session import get_current_user_id

    user_id = get_current_user_id(request)
    entry = get_user_azure(user_id)
    if entry is None:
        # Generic message — never reveal whether cached creds exist for other
        # sessions (SEC-017 enumeration oracle).
        return AzureAuthStatus(
            authenticated=False,
            detail="Azure credentials are not unlocked for this session.",
        )

    try:
        _cred_cls, ClientAuthenticationError, _http_err = _import_identity()
        # Force an actual token round-trip so we know the SP is really valid.
        token = entry.credential.get_token("https://management.azure.com/.default")
        if not token or not token.token:
            raise ClientAuthenticationError("Empty token response.")
    except AppError:
        # AppError already carries a scrubbed client message.
        return AzureAuthStatus(
            authenticated=False,
            detail="Azure credentials could not be validated.",
        )
    except Exception as exc:
        logger.warning("azure_status_token_failed", extra={"error": repr(exc)})
        # Do NOT echo tenant/subscription IDs in the failure case — that would
        # let an attacker who guessed a session cookie confirm which tenant is
        # cached. Only expose them once we know the SP is valid.
        return AzureAuthStatus(
            authenticated=False,
            detail="Azure credentials could not be validated.",
        )

    return AzureAuthStatus(
        authenticated=True,
        tenant_id=entry.tenant_id,
        subscription_id=entry.subscription_id,
        display_name=entry.display_name,
        location=entry.location,
    )


# ---------------------------------------------------------------------------
# Subscriptions
# ---------------------------------------------------------------------------


@router.get(
    "/subscriptions",
    response_model=list[AzureSubscription],
    summary="List Azure subscriptions the Service Principal can see",
)
def azure_subscriptions(request: Request) -> list[AzureSubscription]:
    """Return the subscriptions the SP has any RBAC role on.

    Requires either ``Reader`` at management-group level or an explicit
    subscription-scope role. Returns an empty list if the SP was granted
    zero subscriptions (common misconfiguration).
    """
    entry = _entry_or_401(request)
    SubscriptionClient = _import_resource_client()
    try:
        client = SubscriptionClient(credential=entry.credential)
        subs: list[AzureSubscription] = []
        for sub in client.subscriptions.list():
            subs.append(
                AzureSubscription(
                    subscription_id=str(sub.subscription_id),
                    name=str(sub.display_name or sub.subscription_id),
                    state=str(sub.state) if sub.state else None,
                    tenant_id=entry.tenant_id,
                )
            )
        return subs
    except AppError:
        raise
    except Exception as exc:
        raise _wrap_azure_exception(exc, "Subscriptions.List") from exc


# ---------------------------------------------------------------------------
# Cost Management — real billing data
# ---------------------------------------------------------------------------


def _run_cost_query(
    entry,
    subscription_id: str,
    start_iso: str,
    end_iso: str,
    granularity: str,
) -> dict:
    """Execute a Cost Management ``usage`` query grouped by ServiceName.

    Returns the raw ``QueryResult`` as a dict. Errors are converted to AppError.
    """
    (
        CostManagementClient,
        QueryAggregation,
        QueryDataset,
        QueryDefinition,
        QueryGrouping,
        QueryTimePeriod,
    ) = _import_cost_client()
    try:
        client = CostManagementClient(credential=entry.credential)
        scope = f"/subscriptions/{subscription_id}"
        definition = QueryDefinition(
            type="ActualCost",
            timeframe="Custom",
            time_period=QueryTimePeriod(
                from_property=datetime.fromisoformat(start_iso).replace(tzinfo=UTC),
                to=datetime.fromisoformat(end_iso).replace(tzinfo=UTC),
            ),
            dataset=QueryDataset(
                granularity=granularity,
                aggregation={
                    "totalCost": QueryAggregation(name="Cost", function="Sum"),
                },
                grouping=[
                    QueryGrouping(type="Dimension", name="ServiceName"),
                ],
            ),
        )
        result = client.query.usage(scope=scope, parameters=definition)
        return result.as_dict() if hasattr(result, "as_dict") else result.__dict__
    except AppError:
        raise
    except Exception as exc:
        raise _wrap_azure_exception(exc, "CostManagement.Query.Usage") from exc


def _parse_cost_rows(payload: dict) -> tuple[list[dict], str]:
    """Convert the Cost Management ``QueryResult`` dict into a list of rows.

    Each row has ``date`` (YYYY-MM-DD), ``service``, ``cost`` and ``currency``.
    Handles both column-ordering variants Azure ships with.
    """
    properties = payload.get("properties") or payload
    columns = properties.get("columns") or []
    rows = properties.get("rows") or []
    col_index = {col.get("name"): idx for idx, col in enumerate(columns)}

    def _get(row, name):
        idx = col_index.get(name)
        return row[idx] if idx is not None and idx < len(row) else None

    parsed: list[dict] = []
    currency = "EUR"
    for row in rows:
        cost_raw = _get(row, "PreTaxCost") or _get(row, "Cost") or _get(row, "totalCost")
        usage_raw = _get(row, "UsageDate")
        service_raw = _get(row, "ServiceName")
        currency_raw = _get(row, "Currency") or currency
        if cost_raw is None or usage_raw is None:
            continue
        try:
            # Azure returns UsageDate as YYYYMMDD int or string.
            usage_str = str(usage_raw)
            usage_iso = f"{usage_str[:4]}-{usage_str[4:6]}-{usage_str[6:8]}"
            cost_val = float(cost_raw)
        except (ValueError, TypeError, IndexError):
            continue
        parsed.append(
            {
                "date": usage_iso,
                "service": str(service_raw or "Unknown"),
                "cost": cost_val,
                "currency": str(currency_raw),
            }
        )
        currency = str(currency_raw)
    return parsed, currency


@router.get(
    "/billing",
    response_model=AzureBillingResponse,
    summary="Get Azure cost data via Cost Management",
)
def azure_billing(
    request: Request,
    start: Annotated[str | None, Query(description="YYYY-MM-DD, defaults to ~6 months ago")] = None,
    end: Annotated[
        str | None, Query(description="YYYY-MM-DD (inclusive), defaults to today")
    ] = None,
    months: Annotated[int, Query(ge=1, le=24)] = 6,
    granularity: Annotated[str, Query(description="Daily | Monthly")] = "Daily",
    subscription_id: Annotated[
        str | None, Query(description="Override the cached subscription")
    ] = None,
) -> AzureBillingResponse:
    """Fetch aggregated Azure costs grouped by service.

    Requires the SP to have ``Cost Management Reader`` on the subscription
    (or a broader Reader/Contributor role that includes cost data).
    """
    try:
        date.fromisoformat(start) if start else None
        date.fromisoformat(end) if end else None
    except ValueError as exc:
        raise BadRequest(f"Invalid date format: {exc}. Use YYYY-MM-DD.") from exc

    if granularity not in {"Daily", "Monthly"}:
        raise BadRequest(
            "granularity must be Daily or Monthly.",
            details={"got": granularity},
        )

    entry = _entry_or_401(request)
    sub_id = subscription_id or entry.subscription_id
    if not sub_id:
        raise BadRequest(
            "No subscription_id available. Pass ?subscription_id=… or store one "
            "in the encrypted payload.",
        )

    start_iso, end_iso = _resolve_period(start, end, months_default=months)
    payload = _run_cost_query(entry, sub_id, start_iso, end_iso, granularity)
    rows, currency = _parse_cost_rows(payload)

    by_service_totals: dict[str, float] = {}
    by_day_totals: dict[str, float] = {}
    by_month_totals: dict[str, float] = {}
    total = 0.0

    for row in rows:
        by_service_totals[row["service"]] = by_service_totals.get(row["service"], 0.0) + row["cost"]
        by_day_totals[row["date"]] = by_day_totals.get(row["date"], 0.0) + row["cost"]
        by_month_totals[row["date"][:7]] = by_month_totals.get(row["date"][:7], 0.0) + row["cost"]
        total += row["cost"]

    by_service = [
        AzureBillingByService(
            service=svc,
            cost=round(cost, 4),
            pct=round(cost / total * 100, 2) if total > 0 else 0.0,
            category=categorize(svc),
        )
        for svc, cost in sorted(by_service_totals.items(), key=lambda kv: kv[1], reverse=True)
    ]
    by_day = (
        [AzureBillingByDay(date=d, cost=round(c, 4)) for d, c in sorted(by_day_totals.items())]
        if granularity == "Daily"
        else []
    )
    by_month = [
        AzureBillingByMonth(month=m, cost=round(c, 4)) for m, c in sorted(by_month_totals.items())
    ]

    return AzureBillingResponse(
        subscription_id=sub_id,
        period=DateRange(start=start_iso, end=end_iso),
        total=round(total, 4),
        by_service=by_service,
        by_month=by_month,
        by_day=by_day,
        currency=currency,
        source="cost_management",
        granularity=granularity,
    )


# ---------------------------------------------------------------------------
# Sync — copy Azure Cost Management data into the FinOps events store
# ---------------------------------------------------------------------------


@router.post(
    "/sync",
    response_model=AzureSyncResponse,
    summary="Ingest Azure Cost Management data into the FinOps model — daily granularity",
)
def azure_sync(request: Request, body: AzureSyncRequest) -> AzureSyncResponse:
    """Pull the caller's Azure billing and drop it into the shared events store.

    After this call, every downstream endpoint (KPIs, forecast, services,
    anomalies, drift, …) serves Azure data — that's the whole point. Combine
    with a ``queryClient.invalidateQueries()`` on the frontend so the UI
    re-hydrates.
    """
    entry = _entry_or_401(request)
    sub_id = body.subscription_id or entry.subscription_id
    if not sub_id:
        raise BadRequest(
            "No subscription_id available. Set body.subscription_id or store "
            "one in the encrypted payload.",
        )

    start_iso, end_iso = _resolve_period(None, None, months_default=body.months)
    payload = _run_cost_query(entry, sub_id, start_iso, end_iso, "Daily")
    rows, currency = _parse_cost_rows(payload)

    events: list[BillingEvent] = []
    services: set[str] = set()
    total = 0.0
    for row in rows:
        amount = row["cost"]
        if amount <= 0:
            # Skip zero-cost rows — they inflate row count without adding signal.
            continue
        services.add(row["service"])
        total += amount
        events.append(
            BillingEvent(
                date=row["date"],
                service=row["service"],
                cost=round(amount, 4),
                description=f"Azure · {sub_id}",
            )
        )

    if not events:
        raise BadRequest(
            "Cost Management returned no billed data for this period. Verify "
            "the subscription has activity and the SP holds Cost Management Reader.",
            details={"start": start_iso, "end": end_iso, "subscription_id": sub_id},
        )

    from routes.routes_events import ingest_events
    from core.session import require_current_user_id

    # ingest_events is a FastAPI route: its ``user_id`` param is a Depends()
    # sentinel that only gets resolved through the router. Calling it directly
    # here means we MUST resolve the user ourselves — otherwise events land
    # under the Depends object as a "phantom" key and every downstream reader
    # (analytics/forecast/services/anomalies) sees an empty store.
    user_id = require_current_user_id(request)
    resp = ingest_events(
        EventsIngestRequest(events=events, replace=body.replace),
        user_id=user_id,
    )
    logger.info(
        "azure_sync_ingested",
        extra={
            "subscription_id": sub_id,
            "ingested": resp.ingested,
            "replaced": body.replace,
            "services_count": len(services),
        },
    )
    return AzureSyncResponse(
        ingested=resp.ingested,
        subscription_id=sub_id,
        period_start=start_iso,
        period_end=end_iso,
        services_count=len(services),
        total_cost=round(total, 2),
        currency=currency,
        replaced=body.replace,
    )
