from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Query, Request

from analysis.service_taxonomy import categorize
from core.aws_session import get_user_boto3_session, get_user_region
from core.config import get_settings
from core.errors import AppError, BadRequest
from core.logging import get_logger
from core.session import get_current_user_id, require_current_user_id
from schemas.aws import (
    AWSAccount,
    AWSAuthStatus,
    AWSBillingByDay,
    AWSBillingByMonth,
    AWSBillingByService,
    AWSBillingResponse,
    AWSService,
    AWSSyncRequest,
    AWSSyncResponse,
)
from schemas.gcp import BillingEvent, DateRange, EventsIngestRequest

logger = get_logger(__name__)

router = APIRouter(prefix="/api/aws", tags=["aws"])


def _session_for_request(request: Request):
    """Return a boto3 Session for the caller.

    Prefers the user's cached in-memory Session (built from their PIN-unlocked
    AWS credentials). Falls back to the process default credential chain when
    the user hasn't unlocked yet — useful for anonymous / dev flows.
    """
    user_id = get_current_user_id(request)
    session = get_user_boto3_session(user_id)
    if session is not None:
        return session
    boto3, *_ = _import_boto3()
    return boto3.session.Session(region_name=get_settings().aws_region)


def _region_for_request(request: Request) -> str:
    """Region resolution matches the session: user override first, else config."""
    user_id = get_current_user_id(request)
    user_region = get_user_region(user_id)
    return user_region or get_settings().aws_region


def _import_boto3():
    """Return (boto3, BotoCoreError, ClientError) or raise a 500 AppError.

    boto3 is imported lazily so the service still starts if the library is
    absent — the /status endpoint reports the missing dependency cleanly
    rather than crashing at import time.
    """
    try:
        import boto3  # type: ignore
        from botocore.exceptions import (  # type: ignore
            BotoCoreError,
            ClientError,
            NoCredentialsError,
        )

        return boto3, BotoCoreError, ClientError, NoCredentialsError
    except Exception as exc:
        logger.error("boto3_import_failed", extra={"error": repr(exc)})
        raise AppError(
            "boto3 is not installed. Add it to back/requirements.txt.",
            code="DEPENDENCY_ERROR",
            status_code=500,
        ) from exc


def _sts_get_caller_identity(session=None) -> dict:
    """Call STS GetCallerIdentity. Raises AppError with a clear detail on failure.

    ``session`` is the boto3 Session to use (per-user when available).
    Falls back to the module-default client if None is passed.
    """
    _boto3, _BotoCoreError, ClientError, NoCredentialsError = _import_boto3()
    settings = get_settings()
    try:
        if session is not None:
            client = session.client("sts", region_name=session.region_name or settings.aws_region)
        else:
            client = _boto3.client("sts", region_name=settings.aws_region)
        return client.get_caller_identity()
    except NoCredentialsError:
        raise AppError(
            "AWS credentials not found. Configure AWS_ACCESS_KEY_ID + "
            "AWS_SECRET_ACCESS_KEY, ~/.aws/credentials, or attach an IAM role.",
            code="UNAUTHORIZED",
            status_code=401,
        ) from None
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "AWSClientError")
        raise AppError(
            f"AWS STS rejected the request: {code}",
            code="AWS_API_ERROR",
            status_code=401 if code in {"InvalidClientTokenId", "SignatureDoesNotMatch"} else 502,
            details={"aws_error_code": code},
        ) from exc
    except Exception as exc:
        logger.error("sts_call_failed", extra={"error": repr(exc)})
        raise AppError(
            "Upstream AWS connectivity error.", code="AWS_API_ERROR", status_code=502
        ) from exc


def _resolve_period(start: str | None, end: str | None, months_default: int = 6) -> tuple[str, str]:
    """Return (start, end) YYYY-MM-DD, defaulting to [today - months_default, tomorrow].

    Cost Explorer treats ``end`` as exclusive — we bump it by one day so the
    caller's inclusive ``end`` date is actually included in the result.
    """
    today = date.today()
    if end:
        end_date = date.fromisoformat(end) + timedelta(days=1)
    else:
        end_date = today + timedelta(days=1)
    if start:
        start_date = date.fromisoformat(start)
    else:
        start_date = today.replace(day=1) - timedelta(days=30 * (months_default - 1))
    if start_date >= end_date:
        raise BadRequest(
            "start must be strictly before end.",
            details={"start": start_date.isoformat(), "end": end_date.isoformat()},
        )
    return start_date.isoformat(), end_date.isoformat()


# ---------------------------------------------------------------------------
# Auth status
# ---------------------------------------------------------------------------


@router.get("/status", response_model=AWSAuthStatus, summary="Check AWS credentials via STS")
def aws_status(request: Request) -> AWSAuthStatus:
    """Report whether boto3 can authenticate with AWS for the current user.

    Uses the user's unlocked session when available (see
    ``core.aws_session``), otherwise falls back to the server's default
    credential chain. Never raises — returns ``authenticated=False`` with a
    ``detail`` message so the frontend can render a helpful connect prompt.
    """
    region = _region_for_request(request)
    try:
        session = _session_for_request(request)
        identity = _sts_get_caller_identity(session=session)
        return AWSAuthStatus(
            authenticated=True,
            account_id=identity.get("Account"),
            arn=identity.get("Arn"),
            user_id=identity.get("UserId"),
            region=region,
        )
    except AppError as exc:
        return AWSAuthStatus(
            authenticated=False,
            region=region,
            detail=exc.message,
        )
    except Exception as exc:
        logger.error("aws_status_error", extra={"error": repr(exc)})
        return AWSAuthStatus(
            authenticated=False,
            region=region,
            detail="Unexpected error checking AWS credentials.",
        )


# ---------------------------------------------------------------------------
# Accounts — Organizations API, with STS fallback for single-account setups
# ---------------------------------------------------------------------------


@router.get(
    "/accounts",
    response_model=list[AWSAccount],
    summary="List AWS accounts the current user can see (Organizations + STS fallback)",
)
def aws_accounts(request: Request) -> list[AWSAccount]:
    """Return the AWS accounts visible to the caller.

    Two paths, in priority order:

    1. **Organizations** — the caller is in the org's management account (or
       a delegated admin) and has ``organizations:ListAccounts``. Every
       linked account is returned.
    2. **STS caller identity** — the caller is a standalone IAM user or a
       non-management account. We return a single entry for the current
       account. This is the common case for a plain IAM user in a member
       account.
    """
    session = _session_for_request(request)
    _boto3, _BotoCoreError, ClientError, _NoCredentialsError = _import_boto3()

    # Organizations is a global service exposed only in us-east-1. Always
    # override the session region for this specific client.
    try:
        org_client = session.client("organizations", region_name="us-east-1")
        paginator = org_client.get_paginator("list_accounts")
        accounts: list[AWSAccount] = []
        for page in paginator.paginate():
            for acc in page.get("Accounts", []):
                accounts.append(
                    AWSAccount(
                        account_id=acc.get("Id", ""),
                        name=acc.get("Name") or acc.get("Id", ""),
                        email=acc.get("Email"),
                        status=acc.get("Status"),
                        source="organizations",
                    )
                )
        if accounts:
            return accounts
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        # These codes are expected when the caller is NOT in the management
        # account — quietly fall back to the single-account STS path.
        if code in {
            "AWSOrganizationsNotInUseException",
            "AccessDeniedException",
            "AccessDenied",
        }:
            logger.info(
                "organizations_fallback_to_sts",
                extra={"aws_error_code": code},
            )
        else:
            logger.warning(
                "organizations_unexpected_error",
                extra={"aws_error_code": code, "error": repr(exc)},
            )
    except Exception as exc:
        logger.warning("organizations_unavailable", extra={"error": repr(exc)})

    # STS fallback: return the current account only.
    identity = _sts_get_caller_identity(session=session)
    account_id = identity.get("Account", "")
    return [
        AWSAccount(
            account_id=account_id,
            name=account_id,
            status="ACTIVE",
            source="sts",
        )
    ]


# ---------------------------------------------------------------------------
# Cost Explorer — real billing data
# ---------------------------------------------------------------------------


def _ce_client(session=None):
    """Return a Cost Explorer client on the per-user session (falls back to
    the module boto3 default when the caller isn't unlocked)."""
    _boto3, _BotoCoreError, _ClientError, _NoCredentialsError = _import_boto3()
    settings = get_settings()
    if session is not None:
        return session.client("ce", region_name=settings.aws_cost_explorer_region)
    return _boto3.client("ce", region_name=settings.aws_cost_explorer_region)


def _ce_call(fn, **kwargs):
    """Wrap Cost Explorer calls, mapping AWS errors onto AppError."""
    _boto3, _BotoCoreError, ClientError, NoCredentialsError = _import_boto3()
    try:
        return fn(**kwargs)
    except NoCredentialsError:
        raise AppError(
            "AWS credentials not found. See /api/aws/status for details.",
            code="UNAUTHORIZED",
            status_code=401,
        ) from None
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "AWSClientError")
        status = 401 if code in {"InvalidClientTokenId", "SignatureDoesNotMatch"} else 502
        if code in {"AccessDeniedException", "UnauthorizedOperation"}:
            status = 403
        raise AppError(
            f"AWS Cost Explorer error: {code}",
            code="AWS_API_ERROR",
            status_code=status,
            details={"aws_error_code": code},
        ) from exc
    except Exception as exc:
        logger.error("cost_explorer_error", extra={"error": repr(exc)})
        raise AppError(
            "Upstream AWS connectivity error.", code="AWS_API_ERROR", status_code=502
        ) from exc


@router.get(
    "/billing",
    response_model=AWSBillingResponse,
    summary="Get AWS cost data via Cost Explorer",
)
def aws_billing(
    request: Request,
    start: Annotated[str | None, Query(description="YYYY-MM-DD, defaults to ~6 months ago")] = None,
    end: Annotated[
        str | None, Query(description="YYYY-MM-DD (inclusive), defaults to today")
    ] = None,
    months: Annotated[int, Query(ge=1, le=24)] = 6,
    granularity: Annotated[str, Query(description="DAILY | MONTHLY")] = "DAILY",
    account_id: Annotated[
        str | None,
        Query(description="Filter Cost Explorer to a single linked account (Organizations only)"),
    ] = None,
) -> AWSBillingResponse:
    """Fetch aggregated AWS costs grouped by service.

    Uses Cost Explorer ``GetCostAndUsage`` with metric ``UnblendedCost``.
    Requires ``ce:GetCostAndUsage`` on the caller. A single API call is billed
    at ~$0.01 by AWS — cache responses on the client if you poll.
    """
    try:
        date.fromisoformat(start) if start else None
        date.fromisoformat(end) if end else None
    except ValueError as exc:
        raise BadRequest(f"Invalid date format: {exc}. Use YYYY-MM-DD.") from exc

    gran = granularity.upper()
    if gran not in {"DAILY", "MONTHLY"}:
        raise BadRequest(
            "granularity must be DAILY or MONTHLY.",
            details={"got": granularity},
        )

    start_iso, end_iso = _resolve_period(start, end, months_default=months)

    session = _session_for_request(request)
    identity = _sts_get_caller_identity(session=session)
    resolved_account_id = account_id or identity.get("Account")

    client = _ce_client(session=session)

    ce_kwargs: dict = {
        "TimePeriod": {"Start": start_iso, "End": end_iso},
        "Granularity": gran,
        "Metrics": ["UnblendedCost"],
        "GroupBy": [{"Type": "DIMENSION", "Key": "SERVICE"}],
    }
    if account_id:
        # Filter to one specific linked account (Organizations payer role).
        ce_kwargs["Filter"] = {"Dimensions": {"Key": "LINKED_ACCOUNT", "Values": [account_id]}}

    result = _ce_call(client.get_cost_and_usage, **ce_kwargs)

    by_service_totals: dict[str, float] = {}
    by_day: list[AWSBillingByDay] = []
    by_month_totals: dict[str, float] = {}
    currency = "USD"
    total = 0.0

    for chunk in result.get("ResultsByTime", []):
        period_start = chunk.get("TimePeriod", {}).get("Start", "")
        day_total = 0.0
        for grp in chunk.get("Groups", []):
            svc = (grp.get("Keys") or ["Unknown"])[0]
            metric = grp.get("Metrics", {}).get("UnblendedCost", {})
            amount = float(metric.get("Amount", 0.0) or 0.0)
            currency = metric.get("Unit", currency) or currency
            by_service_totals[svc] = by_service_totals.get(svc, 0.0) + amount
            day_total += amount
        if gran == "DAILY" and period_start:
            by_day.append(AWSBillingByDay(date=period_start, cost=round(day_total, 4)))
            month_key = period_start[:7]
            by_month_totals[month_key] = by_month_totals.get(month_key, 0.0) + day_total
        elif gran == "MONTHLY" and period_start:
            by_month_totals[period_start[:7]] = (
                by_month_totals.get(period_start[:7], 0.0) + day_total
            )
        total += day_total

    by_service = [
        AWSBillingByService(
            service=svc,
            cost=round(cost, 4),
            pct=round(cost / total * 100, 2) if total > 0 else 0.0,
            category=categorize(svc),
        )
        for svc, cost in sorted(by_service_totals.items(), key=lambda kv: kv[1], reverse=True)
    ]
    by_month = [
        AWSBillingByMonth(month=m, cost=round(c, 4)) for m, c in sorted(by_month_totals.items())
    ]

    return AWSBillingResponse(
        account_id=resolved_account_id,
        period=DateRange(
            start=start_iso, end=(date.fromisoformat(end_iso) - timedelta(days=1)).isoformat()
        ),
        total=round(total, 4),
        by_service=by_service,
        by_month=by_month,
        by_day=by_day,
        currency=currency,
        source="cost_explorer",
        granularity=gran,
    )


@router.get(
    "/services",
    response_model=list[AWSService],
    summary="List AWS services with costs in the last N months",
)
def aws_services(
    request: Request,
    months: Annotated[int, Query(ge=1, le=12)] = 3,
) -> list[AWSService]:
    """Return AWS services observed in Cost Explorer over the last N months.

    This is a lightweight alternative to Service Quotas — it only returns
    services that actually incurred cost, sorted by spend descending.
    """
    start_iso, end_iso = _resolve_period(None, None, months_default=months)
    client = _ce_client(session=_session_for_request(request))

    result = _ce_call(
        client.get_cost_and_usage,
        TimePeriod={"Start": start_iso, "End": end_iso},
        Granularity="MONTHLY",
        Metrics=["UnblendedCost"],
        GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
    )

    totals: dict[str, float] = {}
    for chunk in result.get("ResultsByTime", []):
        for grp in chunk.get("Groups", []):
            svc = (grp.get("Keys") or ["Unknown"])[0]
            amount = float(
                grp.get("Metrics", {}).get("UnblendedCost", {}).get("Amount", 0.0) or 0.0
            )
            totals[svc] = totals.get(svc, 0.0) + amount

    services = [
        AWSService(
            service_id=svc,
            name=svc,
            cost_last_period=round(cost, 4),
        )
        for svc, cost in sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    ]
    return services


# ---------------------------------------------------------------------------
# Sync — copy AWS Cost Explorer data into the FinOps events store
# ---------------------------------------------------------------------------


@router.post(
    "/sync",
    response_model=AWSSyncResponse,
    summary="Ingest AWS Cost Explorer data into the FinOps model — daily granularity",
)
def aws_sync(request: Request, body: AWSSyncRequest) -> AWSSyncResponse:
    """Pull the user's AWS billing and drop it into the shared events store.

    After this call, every downstream endpoint (KPIs, forecast, services,
    anomalies, drift, …) serves AWS data — that's the whole point. Combine
    with a ``queryClient.invalidateQueries()`` on the frontend so the entire
    UI re-hydrates.

    Range: last ``months`` months, daily granularity. Single Cost Explorer
    call (~$0.01 billed by AWS).
    """
    session = _session_for_request(request)
    identity = _sts_get_caller_identity(session=session)
    resolved_account_id = body.account_id or identity.get("Account")

    start_iso, end_iso = _resolve_period(None, None, months_default=body.months)
    client = _ce_client(session=session)

    ce_kwargs: dict = {
        "TimePeriod": {"Start": start_iso, "End": end_iso},
        "Granularity": "DAILY",
        "Metrics": ["UnblendedCost"],
        "GroupBy": [{"Type": "DIMENSION", "Key": "SERVICE"}],
    }
    if body.account_id:
        ce_kwargs["Filter"] = {"Dimensions": {"Key": "LINKED_ACCOUNT", "Values": [body.account_id]}}
    result = _ce_call(client.get_cost_and_usage, **ce_kwargs)

    events: list[BillingEvent] = []
    services: set[str] = set()
    total = 0.0
    currency = "USD"
    for chunk in result.get("ResultsByTime", []):
        day = chunk.get("TimePeriod", {}).get("Start", "")
        if not day:
            continue
        for grp in chunk.get("Groups", []):
            svc = (grp.get("Keys") or ["Unknown"])[0]
            metric = grp.get("Metrics", {}).get("UnblendedCost", {})
            amount = float(metric.get("Amount", 0.0) or 0.0)
            currency = metric.get("Unit", currency) or currency
            if amount <= 0:
                # Skip zero-cost rows — they inflate row count without value
                # and Pydantic's ``cost >= 0`` still lets legitimate free-tier
                # days through (they're just not stored explicitly).
                continue
            services.add(svc)
            total += amount
            events.append(
                BillingEvent(
                    date=day,
                    service=svc,
                    cost=round(amount, 4),
                    description=f"AWS · {resolved_account_id or 'unknown-account'}",
                )
            )

    if not events:
        raise BadRequest(
            "Cost Explorer returned no billed data for this period. Verify "
            "the account has activity and Cost Explorer is enabled.",
            details={
                "start": start_iso,
                "end": end_iso,
                "account_id": resolved_account_id,
            },
        )

    from routes.routes_events import ingest_events

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
        "aws_sync_ingested",
        extra={
            "account_id": resolved_account_id,
            "ingested": resp.ingested,
            "replaced": body.replace,
            "services_count": len(services),
        },
    )
    return AWSSyncResponse(
        ingested=resp.ingested,
        account_id=resolved_account_id,
        period_start=start_iso,
        period_end=(date.fromisoformat(end_iso) - timedelta(days=1)).isoformat(),
        services_count=len(services),
        total_cost=round(total, 2),
        currency=currency,
        replaced=body.replace,
    )
