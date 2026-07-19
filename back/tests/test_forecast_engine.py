"""Correctness contracts on the forecast engine and the daily-grid pipeline.

Covers the DS-audit fixes:
  - summary totals computed over the FULL horizon (not a hardcoded 30 days);
  - prediction intervals that widen with the lead (empirical out-of-sample
    bands from the walk-forward CV errors);
  - calendar regularization in the loader (gaps -> 0, monthly exports spread);
  - simulation projection covering 12 distinct consecutive calendar months;
  - ACF/PACF no longer 500s on 29-56 point series;
  - anomaly z-scores on STL residuals (a trend no longer masks real spikes).
"""

from __future__ import annotations

from datetime import date, timedelta
from itertools import pairwise

import numpy as np
import pandas as pd
import pytest


def _inject(user_id: str, rows: list[dict]):
    from core.user_context import set_current_user_id
    from routes import routes_events

    routes_events._injected_events[user_id] = list(rows)
    return set_current_user_id(user_id)


def _cleanup(user_id: str, token) -> None:
    from core.user_context import reset_current_user_id
    from data.loader import invalidate_cache
    from routes import routes_events

    routes_events._injected_events.pop(user_id, None)
    reset_current_user_id(token)
    invalidate_cache()


def _daily_rows(dates: pd.DatetimeIndex, values: np.ndarray, service: str = "X") -> list[dict]:
    return [
        {
            "ds": d.strftime("%Y-%m-%d"),
            "Sous-total (€)": float(v),
            "service": service,
            "description": "",
        }
        for d, v in zip(dates, values, strict=True)
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Module fixture — one 180-day trended + weekly-seasonal series, injected once
# so the module's get_forecast/benchmark calls share the scoped cache entries.
# ─────────────────────────────────────────────────────────────────────────────

_FC_USER = "fc-test-user"


@pytest.fixture(scope="module")
def forecast_series():
    from core.cache import app_cache
    from data.loader import invalidate_cache

    n = 180
    dates = pd.date_range("2026-01-01", periods=n, freq="D")
    rng = np.random.default_rng(seed=123)
    i = np.arange(n, dtype=float)
    values = 100.0 + 0.3 * i + 8.0 * np.sin(2 * np.pi * i / 7) + rng.normal(0, 3, n)

    token = _inject(_FC_USER, _daily_rows(dates, values))
    invalidate_cache()
    app_cache.clear()
    yield dates
    _cleanup(_FC_USER, token)
    app_cache.clear()


# ─────────────────────────────────────────────────────────────────────────────
# Summary KPIs — totals over the full horizon
# ─────────────────────────────────────────────────────────────────────────────


def test_summary_totals_cover_full_horizon(forecast_series):
    """total_forecast must sum the whole horizon and daily_avg must divide by
    it — the old code summed [:30] and divided by 30 regardless of horizon."""
    from forecast.engine import get_forecast

    points, summary = get_forecast(90, "ETS")
    future = [p for p in points if p.actual is None]
    assert len(future) == 90
    assert summary.horizon_days == 90

    expected_total = sum(max(0.0, p.forecast) for p in future)
    assert summary.total_forecast == pytest.approx(expected_total, rel=1e-3)
    assert summary.daily_avg_forecast == pytest.approx(summary.total_forecast / 90, rel=1e-3)
    # Sanity: a 90-day total on a ~130-160 €/day series can't be a 30-day one.
    assert summary.total_forecast > 60 * 100.0


def test_summary_daily_avg_on_short_horizon(forecast_series):
    """horizon=7: daily_avg = total/7 (the old /30 was ~4.3x too small)."""
    from forecast.engine import get_forecast

    points, summary = get_forecast(7, "ETS")
    future = [p for p in points if p.actual is None]
    assert len(future) == 7
    assert summary.daily_avg_forecast == pytest.approx(summary.total_forecast / 7, rel=1e-3)
    # The series runs at >= 100 €/day — a /30 division would sit near 30.
    assert summary.daily_avg_forecast > 80.0


# ─────────────────────────────────────────────────────────────────────────────
# Prediction intervals — width grows with the lead
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("model", ["ETS", "Theta", "SES"])
def test_ci_width_non_decreasing_and_growing(forecast_series, model):
    from forecast.engine import get_forecast

    points, _ = get_forecast(90, model)
    future = [p for p in points if p.actual is None]
    widths = [p.high95 - p.low95 for p in future]

    assert all(w >= 0 for w in widths)
    # Non-decreasing profile. Bounds are rounded to 4 decimals on the wire, so
    # the width can jitter by up to 2e-4 without any real shrink.
    for a, b in pairwise(widths):
        assert b >= a - 2e-4, f"{model}: CI width shrank from {a} to {b}"
    # Strict growth over the horizon — the old constant-width bands displayed
    # the same uncertainty at D+90 as at D+1.
    assert widths[-1] > widths[0] * 1.2, (
        f"{model}: width at D+90 ({widths[-1]:.2f}) barely above D+1 ({widths[0]:.2f})"
    )


def test_cv_sigma_by_lead_monotone_and_extrapolated(forecast_series):
    from data.loader import load_daily_costs
    from forecast.engine import MODELS, _cv_sigma_by_lead

    arr = load_daily_costs()["y"].values.astype(float)
    _, fn = MODELS["SES"]
    sigma = _cv_sigma_by_lead(arr, fn, horizon=60, model_name="SES")
    assert sigma is not None
    assert len(sigma) == 60
    assert np.all(np.isfinite(sigma))
    assert np.all(np.diff(sigma) >= -1e-12), "sigma must be non-decreasing in the lead"
    assert sigma[-1] > sigma[0] > 0


def test_benchmark_reports_cv_horizon(forecast_series):
    from forecast.engine import get_model_benchmarks

    bench = get_model_benchmarks(28)
    assert len(bench) == 6
    assert all(b.cv_horizon == 28 for b in bench)
    winners = [b for b in bench if b.winner]
    assert len(winners) == 1 and winners[0].rank == 1


def test_ci_bounds_stay_coherent_on_decaying_series():
    """On a steadily decaying series the raw forecast goes negative; the
    displayed point is clamped at 0 — the bands must stay ordered around it
    (the unclamped version produced high95 < low95 = 0)."""
    from forecast.engine import get_forecast

    user = "decay-test-user"
    n = 120
    dates = pd.date_range("2026-01-01", periods=n, freq="D")
    rng = np.random.default_rng(seed=21)
    values = np.linspace(1000, 40, n) + rng.normal(0, 5, n)
    token = _inject(user, _daily_rows(dates, values))
    try:
        from data.loader import invalidate_cache

        invalidate_cache()
        points, _ = get_forecast(90, "ETS")
        for p in points:
            if p.actual is not None:
                continue
            assert p.forecast >= 0
            assert 0 <= p.low95 <= p.forecast + 1e-6, p
            assert p.forecast <= p.high95 + 1e-6, p
            assert 0 <= p.low80 <= p.forecast + 1e-6, p
            assert p.forecast <= p.high80 + 1e-6, p
            assert p.low95 <= p.high95 + 1e-6 and p.low80 <= p.high80 + 1e-6, p
    finally:
        _cleanup(user, token)


def test_benchmark_has_no_winner_when_no_cv_fold_fits():
    """14-30 points: no walk-forward fold is possible (needs n >= 30 + h) —
    no model may be sold as 'winner' on zero evidence."""
    from forecast.engine import get_model_benchmarks

    user = "shortbench-test-user"
    dates = pd.date_range("2026-01-01", periods=20, freq="D")
    rng = np.random.default_rng(seed=3)
    token = _inject(user, _daily_rows(dates, 100 + rng.normal(0, 2, 20)))
    try:
        from data.loader import invalidate_cache

        invalidate_cache()
        bench = get_model_benchmarks()
        assert all(b.mae is None for b in bench)
        assert not any(b.winner for b in bench)
    finally:
        _cleanup(user, token)


# ─────────────────────────────────────────────────────────────────────────────
# Loader — calendar regularization
# ─────────────────────────────────────────────────────────────────────────────


def test_daily_from_events_fills_missing_days_with_zero():
    from data.loader import _daily_from_events

    dates = list(pd.date_range("2026-03-01", periods=20, freq="D"))
    removed = {dates[5].strftime("%Y-%m-%d"), dates[12].strftime("%Y-%m-%d")}
    events = pd.DataFrame(
        [
            {"ds": d.strftime("%Y-%m-%d"), "Sous-total (€)": 10.0}
            for d in dates
            if d.strftime("%Y-%m-%d") not in removed
        ]
    )
    df = _daily_from_events(events)

    assert len(df) == 20, "gaps must be reindexed onto the full daily calendar"
    assert (df["ds"].diff().dt.days.dropna() == 1).all()
    zero_days = set(df.loc[df["y"] == 0.0, "ds"].dt.strftime("%Y-%m-%d"))
    assert zero_days == removed
    assert df["y"].sum() == pytest.approx(18 * 10.0)


def test_monthly_export_is_spread_across_month_days():
    from data.loader import _daily_from_events

    events = pd.DataFrame(
        [
            {"ds": "2026-01-01", "Sous-total (€)": 310.0},
            {"ds": "2026-02-01", "Sous-total (€)": 280.0},
            {"ds": "2026-03-01", "Sous-total (€)": 310.0},
        ]
    )
    df = _daily_from_events(events)

    # Dense daily series covering Jan 1 -> Mar 31
    assert len(df) == 31 + 28 + 31
    assert (df["ds"].diff().dt.days.dropna() == 1).all()
    # Monthly totals preserved, spread evenly (Jan: 310/31 = 10/day)
    jan = df[df["ds"].dt.month == 1]["y"]
    assert jan.sum() == pytest.approx(310.0, abs=1e-6)
    assert jan.iloc[0] == pytest.approx(10.0, abs=1e-6)
    feb = df[df["ds"].dt.month == 2]["y"]
    assert feb.sum() == pytest.approx(280.0, abs=1e-6)


def test_monthly_export_with_missing_month_is_zero_filled():
    """A month absent from the export must become zeros on the calendar, not a
    31-day hole that desyncs the weekly seasonality downstream."""
    from data.loader import _daily_from_events

    events = pd.DataFrame(
        [
            {"ds": "2026-01-01", "Sous-total (€)": 310.0},
            {"ds": "2026-02-01", "Sous-total (€)": 280.0},
            {"ds": "2026-04-01", "Sous-total (€)": 300.0},  # March missing
        ]
    )
    df = _daily_from_events(events)

    assert len(df) == 31 + 28 + 31 + 30  # Jan 1 -> Apr 30, dense
    assert (df["ds"].diff().dt.days.dropna() == 1).all()
    march = df[df["ds"].dt.month == 3]["y"]
    assert len(march) == 31 and (march == 0.0).all()
    assert df["y"].sum() == pytest.approx(310.0 + 280.0 + 300.0, abs=1e-6)


def test_two_month_export_is_spread_too():
    """The monthly detection must work from a single delta (2 rows) — a 1-2
    month export used to slip through and inflate daily_avg ~30x."""
    from data.loader import _daily_from_events

    events = pd.DataFrame(
        [
            {"ds": "2026-01-01", "Sous-total (€)": 310.0},
            {"ds": "2026-02-01", "Sous-total (€)": 280.0},
        ]
    )
    df = _daily_from_events(events)

    assert len(df) == 31 + 28
    assert df["y"].iloc[0] == pytest.approx(310.0 / 31, abs=1e-6)
    assert df["y"].mean() == pytest.approx((310.0 + 280.0) / 59, abs=1e-6)


def test_partial_current_month_spread_capped_at_today():
    """The current month's exported total only covers spend to date — it must
    be spread over the elapsed days, not diluted across future days (which
    would understate the daily rate and put fake 'actuals' after today)."""
    from data.loader import _daily_from_events

    today = pd.Timestamp.today().normalize()
    cur_start = today.replace(day=1)
    prev_start = (cur_start - pd.Timedelta(days=1)).replace(day=1)
    month_end = cur_start + pd.offsets.MonthEnd(0)

    events = pd.DataFrame(
        [
            {"ds": prev_start.strftime("%Y-%m-%d"), "Sous-total (€)": 310.0},
            {"ds": cur_start.strftime("%Y-%m-%d"), "Sous-total (€)": 190.0},
        ]
    )
    df = _daily_from_events(events)

    expected_end = today if today < month_end else month_end
    assert df["ds"].max() == expected_end, "spread must not extend past today"
    elapsed = (expected_end - cur_start).days + 1
    cur = df[df["ds"] >= cur_start]["y"]
    assert len(cur) == elapsed
    assert cur.iloc[0] == pytest.approx(190.0 / elapsed, abs=1e-6)
    assert cur.sum() == pytest.approx(190.0, abs=1e-6)


# ─────────────────────────────────────────────────────────────────────────────
# Simulation — 12 distinct, consecutive projected calendar months
# ─────────────────────────────────────────────────────────────────────────────


def test_projected_events_cover_12_distinct_consecutive_months():
    from analysis.simulation import _projected_events
    from schemas.simulation import CostBreakdown, SimulationInputs

    inputs = SimulationInputs(
        project_name="Test",
        monthly_active_users=100,
        interactions_per_user_per_month=10,
        agents_count=1,
        llm_id="test-llm",
    )
    cost = CostBreakdown(
        llm_input=100.0, llm_output=50.0, tools=10.0, infrastructure=20.0, total_monthly=180.0
    )
    events = _projected_events(inputs, cost)

    months = sorted({e["date"][:7] for e in events})
    assert len(months) == 12, f"expected 12 distinct months, got {len(months)}: {months}"

    # Consecutive, starting the month after the current one — no duplicates,
    # no holes (the old 30-day stepping doubled one month and skipped another).
    first = date.today().replace(day=1)
    expected = []
    total = first.year * 12 + (first.month - 1)
    for k in range(1, 13):
        t = total + k
        expected.append(f"{t // 12:04d}-{t % 12 + 1:02d}")
    assert months == expected

    # Each month carries the full monthly amount exactly once.
    by_month: dict[str, float] = {}
    for e in events:
        by_month[e["date"][:7]] = by_month.get(e["date"][:7], 0.0) + e["cost"]
    for m, amount in by_month.items():
        assert amount == pytest.approx(180.0, abs=0.05), f"month {m} total {amount}"


# ─────────────────────────────────────────────────────────────────────────────
# ACF — short series must degrade gracefully, not 500
# ─────────────────────────────────────────────────────────────────────────────


def test_acf_on_40_points_caps_lags_instead_of_crashing():
    """pacf requires nlags < n//2 — 29-56 point series used to crash with the
    default nlags=28. The engine must cap and return what n supports."""
    from analysis.timeseries import get_acf_pacf

    user = "acf-test-user"
    n = 40
    dates = pd.date_range("2026-01-01", periods=n, freq="D")
    rng = np.random.default_rng(seed=5)
    token = _inject(user, _daily_rows(dates, 100 + rng.normal(0, 5, n)))
    try:
        from data.loader import invalidate_cache

        invalidate_cache()
        result = get_acf_pacf(28)
        assert 1 <= len(result) <= n // 2 - 1
        assert result[0].lag == 1
    finally:
        _cleanup(user, token)


# ─────────────────────────────────────────────────────────────────────────────
# Anomalies — STL-residual z-scores catch what a trend used to mask
# ─────────────────────────────────────────────────────────────────────────────


def test_anomaly_spike_detected_despite_strong_trend():
    """On a strongly trended series, the global std is inflated by the trend
    itself: a +400 spike over a 0->1000 ramp has a global z of ~1.4 and was
    missed. Scored on STL residuals, it is unmissable."""
    from analysis.timeseries import get_anomalies

    user = "anom-test-user"
    n = 120
    dates = pd.date_range("2026-01-01", periods=n, freq="D")
    rng = np.random.default_rng(seed=9)
    values = np.linspace(0, 1000, n) + rng.normal(0, 5, n)
    spike_idx = 60
    values[spike_idx] += 400.0

    token = _inject(user, _daily_rows(dates, values))
    try:
        from data.loader import invalidate_cache

        invalidate_cache()
        result = get_anomalies(3.0)
        spike_date = dates[spike_idx].strftime("%Y-%m-%d")
        spike_point = next(p for p in result if p.date == spike_date)
        assert spike_point.is_anomaly, "trend-masked spike must be flagged on residuals"
        # A clean trend must not be flagged wholesale: the spike aside, only a
        # tiny fraction of points may exceed |z| > 3 by chance.
        others = [p for p in result if p.date != spike_date and p.is_anomaly]
        assert len(others) <= max(2, int(0.05 * n)), (
            f"too many false anomalies on a clean trend: {len(others)}"
        )
    finally:
        _cleanup(user, token)


def test_page_hinkley_quiet_on_constant_reference_window():
    """Constant reference half (simulation push / spread monthly export) must
    not zero the alarm threshold: a stable-mean noisy second half is NOT a
    changepoint storm."""
    from analysis.advanced import compute_drift

    user = "ph-test-user"
    n = 100
    dates = pd.date_range("2026-01-01", periods=n, freq="D")
    rng = np.random.default_rng(seed=17)
    values = np.concatenate([np.full(50, 100.0), 100.0 + rng.normal(0, 5, 50)])
    token = _inject(user, _daily_rows(dates, values))
    try:
        from data.loader import invalidate_cache

        invalidate_cache()
        result = compute_drift(reference_frac=0.5, psi_bins=10)
        # constant -> noisy IS a (variance) regime change, so a few alarms are
        # legitimate; the failure mode guarded here is the threshold-zero storm
        # that flagged nearly every point of the current window (~25/50).
        assert result.n_changepoints_detected <= 5, (
            f"changepoint storm on stable series: {result.n_changepoints_detected}"
        )
    finally:
        _cleanup(user, token)


def test_distribution_on_constant_series_has_no_nan():
    """scipy normality tests return NaN on a constant sample — the endpoint
    must return an empty test list, never NaN in the JSON."""
    from analysis.advanced import compute_distribution

    user = "dist-test-user"
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    token = _inject(user, _daily_rows(dates, np.full(30, 10.0)))
    try:
        from data.loader import invalidate_cache

        invalidate_cache()
        r = compute_distribution()
        assert r.normality_tests == []
        assert r.skewness == 0.0 and r.kurtosis == 0.0
    finally:
        _cleanup(user, token)


def test_horizon_gap_series_forecast_dates_are_contiguous():
    """With the loader regularization, forecast future dates start right after
    the last calendar day even when the raw events had holes."""
    from forecast.engine import get_forecast

    user = "gap-test-user"
    dates = list(pd.date_range("2026-01-01", periods=60, freq="D"))
    # Drop 6 scattered days — weekly seasonality would desync without reindex.
    kept = [d for i, d in enumerate(dates) if i % 10 != 3]
    rng = np.random.default_rng(seed=11)
    token = _inject(user, _daily_rows(pd.DatetimeIndex(kept), 100 + rng.normal(0, 4, len(kept))))
    try:
        from data.loader import invalidate_cache

        invalidate_cache()
        points, summary = get_forecast(14, "Seasonal Naive")
        future = [p for p in points if p.actual is None]
        assert len(future) == 14
        assert future[0].date == (dates[-1] + timedelta(days=1)).strftime("%Y-%m-%d")
        assert summary.horizon_days == 14
    finally:
        _cleanup(user, token)
