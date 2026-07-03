from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated, List, Optional

from fastapi import APIRouter, Query

from core.config import get_settings
from core.errors import AppError, BadRequest
from core.logging import get_logger
from schemas.aws import (
    AWSAuthStatus,
    AWSBillingByDay,
    AWSBillingByMonth,
    AWSBillingByService,
    AWSBillingResponse,
    AWSService,
)
from schemas.gcp import DateRange

logger = get_logger(__name__)

router = APIRouter(prefix="/api/aws", tags=["aws"])


def _import_boto3():
    """Return (boto3, BotoCoreError, ClientError) or raise a 500 AppError.

    boto3 is imported lazily so the service still starts if the library is
    absent — the /status endpoint reports the missing dependency cleanly
    rather than crashing at import time.
    """
    try:
        import boto3  # type: ignore
        from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError  # type: ignore

        return boto3, BotoCoreError, ClientError, NoCredentialsError
    except Exception as exc:
        logger.error("boto3_import_failed", extra={"error": repr(exc)})
        raise AppError(
            "boto3 is not installed. Add it to back/requirements.txt.",
            code="DEPENDENCY_ERROR",
            status_code=500,
        )


def _sts_get_caller_identity() -> dict:
    """Call STS GetCallerIdentity. Raises AppError with a clear detail on failure."""
    boto3, _BotoCoreError, ClientError, NoCredentialsError = _import_boto3()
    settings = get_settings()
    try:
        client = boto3.client("sts", region_name=settings.aws_region)
        return client.get_caller_identity()
    except NoCredentialsError:
        raise AppError(
            "AWS credentials not found. Configure AWS_ACCESS_KEY_ID + "
            "AWS_SECRET_ACCESS_KEY, ~/.aws/credentials, or attach an IAM role.",
            code="UNAUTHORIZED",
            status_code=401,
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "AWSClientError")
        raise AppError(
            f"AWS STS rejected the request: {code}",
            code="AWS_API_ERROR",
            status_code=401 if code in {"InvalidClientTokenId", "SignatureDoesNotMatch"} else 502,
            details={"aws_error_code": code},
        )
    except Exception as exc:
        logger.error("sts_call_failed", extra={"error": repr(exc)})
        raise AppError("Upstream AWS connectivity error.", code="AWS_API_ERROR", status_code=502)


def _resolve_period(start: Optional[str], end: Optional[str], months_default: int = 6) -> tuple[str, str]:
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
def aws_status() -> AWSAuthStatus:
    """Report whether boto3 can authenticate with AWS.

    Never raises — returns ``authenticated=False`` with a ``detail`` message
    so the frontend can render a helpful connect-your-AWS prompt.
    """
    settings = get_settings()
    try:
        identity = _sts_get_caller_identity()
        return AWSAuthStatus(
            authenticated=True,
            account_id=identity.get("Account"),
            arn=identity.get("Arn"),
            user_id=identity.get("UserId"),
            region=settings.aws_region,
        )
    except AppError as exc:
        return AWSAuthStatus(
            authenticated=False,
            region=settings.aws_region,
            detail=exc.message,
        )
    except Exception as exc:
        logger.error("aws_status_error", extra={"error": repr(exc)})
        return AWSAuthStatus(
            authenticated=False,
            region=settings.aws_region,
            detail="Unexpected error checking AWS credentials.",
        )


# ---------------------------------------------------------------------------
# Cost Explorer — real billing data
# ---------------------------------------------------------------------------

def _ce_client():
    boto3, _BotoCoreError, _ClientError, _NoCredentialsError = _import_boto3()
    settings = get_settings()
    return boto3.client("ce", region_name=settings.aws_cost_explorer_region)


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
        )
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
        )
    except Exception as exc:
        logger.error("cost_explorer_error", extra={"error": repr(exc)})
        raise AppError("Upstream AWS connectivity error.", code="AWS_API_ERROR", status_code=502)


@router.get(
    "/billing",
    response_model=AWSBillingResponse,
    summary="Get AWS cost data via Cost Explorer",
)
def aws_billing(
    start: Annotated[Optional[str], Query(description="YYYY-MM-DD, defaults to ~6 months ago")] = None,
    end: Annotated[Optional[str], Query(description="YYYY-MM-DD (inclusive), defaults to today")] = None,
    months: Annotated[int, Query(ge=1, le=24)] = 6,
    granularity: Annotated[str, Query(description="DAILY | MONTHLY")] = "DAILY",
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
        raise BadRequest(f"Invalid date format: {exc}. Use YYYY-MM-DD.")

    gran = granularity.upper()
    if gran not in {"DAILY", "MONTHLY"}:
        raise BadRequest(
            "granularity must be DAILY or MONTHLY.",
            details={"got": granularity},
        )

    start_iso, end_iso = _resolve_period(start, end, months_default=months)

    identity = _sts_get_caller_identity()
    account_id = identity.get("Account")

    client = _ce_client()

    result = _ce_call(
        client.get_cost_and_usage,
        TimePeriod={"Start": start_iso, "End": end_iso},
        Granularity=gran,
        Metrics=["UnblendedCost"],
        GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
    )

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
            by_month_totals[period_start[:7]] = by_month_totals.get(period_start[:7], 0.0) + day_total
        total += day_total

    by_service = [
        AWSBillingByService(
            service=svc,
            cost=round(cost, 4),
            pct=round(cost / total * 100, 2) if total > 0 else 0.0,
        )
        for svc, cost in sorted(by_service_totals.items(), key=lambda kv: kv[1], reverse=True)
    ]
    by_month = [
        AWSBillingByMonth(month=m, cost=round(c, 4))
        for m, c in sorted(by_month_totals.items())
    ]

    return AWSBillingResponse(
        account_id=account_id,
        period=DateRange(start=start_iso, end=(date.fromisoformat(end_iso) - timedelta(days=1)).isoformat()),
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
    response_model=List[AWSService],
    summary="List AWS services with costs in the last N months",
)
def aws_services(
    months: Annotated[int, Query(ge=1, le=12)] = 3,
) -> List[AWSService]:
    """Return AWS services observed in Cost Explorer over the last N months.

    This is a lightweight alternative to Service Quotas — it only returns
    services that actually incurred cost, sorted by spend descending.
    """
    start_iso, end_iso = _resolve_period(None, None, months_default=months)
    client = _ce_client()

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
            amount = float(grp.get("Metrics", {}).get("UnblendedCost", {}).get("Amount", 0.0) or 0.0)
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
