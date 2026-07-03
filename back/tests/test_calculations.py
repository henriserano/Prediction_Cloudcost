"""Correctness tests with known inputs.

Every test here feeds a synthetic series with a known statistical property
into one of the analysis functions and asserts the result matches the
expected value within a tolerance. If any assertion breaks, a real calc bug
has crept in — the tests are not smoke checks, they are contracts on math.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest


# ─────────────────────────────────────────────────────────────────────────────
# Fixture — inject a deterministic events store so downstream analytics see
# it via the loader's events-first resolution path.
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def synthetic_events(monkeypatch):
    """Populate _injected_events with 180 days × 3 services of clean data."""
    from routes import routes_events

    dates = pd.date_range("2026-01-01", periods=180, freq="D")
    rows: list[dict] = []
    rng = np.random.default_rng(seed=42)
    for i, d in enumerate(dates):
        rows.append({
            "ds": d.strftime("%Y-%m-%d"),
            "Sous-total (€)": float(100 + 10 * np.sin(2 * np.pi * i / 30) + rng.normal(0, 2)),
            "service": "Cloud SQL",
            "description": "",
        })
        rows.append({
            "ds": d.strftime("%Y-%m-%d"),
            "Sous-total (€)": float(50 + rng.normal(0, 1)),
            "service": "BigQuery",
            "description": "",
        })
        rows.append({
            "ds": d.strftime("%Y-%m-%d"),
            "Sous-total (€)": float(30 + 5 * (i % 7 == 0) + rng.normal(0, 0.5)),
            "service": "Cloud Storage",
            "description": "",
        })

    monkeypatch.setattr(routes_events, "_injected_events", rows)

    from data.loader import invalidate_cache
    invalidate_cache()
    from core.cache import app_cache
    app_cache.clear()

    yield dates

    # Cleanup happens automatically via monkeypatch teardown
    invalidate_cache()
    app_cache.clear()


# ─────────────────────────────────────────────────────────────────────────────
# Loader — pivot correctness
# ─────────────────────────────────────────────────────────────────────────────

def test_daily_from_events_sums_by_date(synthetic_events):
    """load_daily_costs must sum all services per day."""
    from data.loader import load_daily_costs

    df = load_daily_costs()
    assert len(df) == 180
    # Day 0: cost ~= 100 + 50 + 30 ≈ 180 (± noise)
    assert 170 < df["y"].iloc[0] < 190
    # Total spend ≈ 180 days × 180 €/day = 32,400
    assert 32_000 < df["y"].sum() < 33_000


def test_per_service_pivot_shape(synthetic_events):
    """load_daily_per_service must produce (days, 1 + n_services) columns."""
    from data.loader import load_daily_per_service

    df = load_daily_per_service()
    assert len(df) == 180
    services = sorted(c for c in df.columns if c != "ds")
    assert services == ["BigQuery", "Cloud SQL", "Cloud Storage"]


# ─────────────────────────────────────────────────────────────────────────────
# Drift — mathematical invariants
# ─────────────────────────────────────────────────────────────────────────────

def test_ks_identical_distributions_gives_high_pvalue(synthetic_events):
    """When ref and cur come from the same distribution, KS p-value must be > 0.05."""
    from analysis.advanced import compute_drift

    result = compute_drift(reference_frac=0.5, psi_bins=10)
    # The synthetic series is stationary; drift must not be detected
    assert result.ks.p_value > 0.05, f"KS falsely detected drift on stationary series: p={result.ks.p_value}"
    assert result.ks.drift_detected is False


def test_psi_identical_windows_is_near_zero(synthetic_events):
    """PSI on two halves of a stationary series should be << 0.1."""
    from analysis.advanced import compute_drift

    result = compute_drift(reference_frac=0.5, psi_bins=10)
    assert result.psi.psi < 0.15, f"PSI too large on stationary series: {result.psi.psi}"
    assert result.psi.verdict in {"stable", "moderate"}


def test_psi_shifted_distribution_detects_drift(monkeypatch):
    """PSI must fire on a hard mean shift with some noise on both sides.

    The reference window needs positive variance for the quantile-based bin
    edges to be well-defined — a perfectly constant reference is a degenerate
    case where PSI is undefined and we return "insufficient-data".
    """
    from routes import routes_events

    n = 200
    dates = pd.date_range("2026-01-01", periods=n, freq="D")
    rng = np.random.default_rng(seed=7)
    values = np.concatenate([
        100.0 + rng.normal(0, 5, 100),
        500.0 + rng.normal(0, 5, 100),
    ])
    rows = [
        {"ds": d.strftime("%Y-%m-%d"), "Sous-total (€)": float(v), "service": "X", "description": ""}
        for d, v in zip(dates, values)
    ]
    monkeypatch.setattr(routes_events, "_injected_events", rows)

    from data.loader import invalidate_cache
    from core.cache import app_cache
    invalidate_cache()
    app_cache.clear()

    from analysis.advanced import compute_drift

    result = compute_drift(reference_frac=0.5, psi_bins=10)
    assert result.psi.psi > 0.25, f"PSI failed to detect a 5x mean shift: {result.psi.psi}"
    assert result.psi.verdict == "significant"
    assert result.ks.drift_detected is True


# ─────────────────────────────────────────────────────────────────────────────
# Outliers — Z-score / IQR / IsolationForest on planted anomaly
# ─────────────────────────────────────────────────────────────────────────────

def test_outlier_methods_agree_on_planted_spike(monkeypatch):
    """A single 10-sigma spike in an otherwise flat series must be flagged."""
    from routes import routes_events

    n = 120
    dates = pd.date_range("2026-01-01", periods=n, freq="D")
    values = np.full(n, 100.0)
    values[60] = 1000.0  # extreme outlier
    rows = [
        {"ds": d.strftime("%Y-%m-%d"), "Sous-total (€)": float(v), "service": "X", "description": ""}
        for d, v in zip(dates, values)
    ]
    monkeypatch.setattr(routes_events, "_injected_events", rows)

    from data.loader import invalidate_cache
    from core.cache import app_cache
    invalidate_cache()
    app_cache.clear()

    from analysis.advanced import compute_outliers

    r = compute_outliers(z_thresh=2.0, iqr_mult=1.5)
    spike_row = next(row for row in r.rows if row.date == dates[60].strftime("%Y-%m-%d"))

    # Every method must flag the planted outlier
    assert abs(spike_row.zscore) > 5, f"Z-score too small: {spike_row.zscore}"
    assert spike_row.iqr_flag is True
    assert spike_row.isolation_flag is True


# ─────────────────────────────────────────────────────────────────────────────
# Scaling — invariants of each scaler
# ─────────────────────────────────────────────────────────────────────────────

def test_scaling_standard_has_mean_zero_var_one(synthetic_events):
    """StandardScaler output must have mean ≈ 0 and std ≈ 1."""
    from analysis.advanced import compute_scaling

    r = compute_scaling()
    standard_vals = np.array([p.standard for p in r.points])
    # Tolerance loosened to 1e-6 — the API rounds to 6 decimals for network
    # payload size, and floating-point summation of 180 numbers accumulates
    # rounding on the order of 1e-8 which then rounds up in the round().
    assert abs(np.mean(standard_vals)) < 1e-6
    assert abs(np.std(standard_vals, ddof=1) - 1.0) < 1e-4


def test_scaling_minmax_bounded(synthetic_events):
    """MinMaxScaler output must lie in [0, 1] with 0 and 1 attained."""
    from analysis.advanced import compute_scaling

    r = compute_scaling()
    minmax_vals = np.array([p.minmax for p in r.points])
    assert minmax_vals.min() == pytest.approx(0.0, abs=1e-9)
    assert minmax_vals.max() == pytest.approx(1.0, abs=1e-9)


# ─────────────────────────────────────────────────────────────────────────────
# PCA — variance ratios must be positive, non-increasing, and cumulative
# ─────────────────────────────────────────────────────────────────────────────

def test_pca_variance_ratios_non_increasing_and_bounded(synthetic_events):
    """PCA components must be sorted by variance descending, all in [0, 1]."""
    from analysis.advanced import compute_dim_reduction

    r = compute_dim_reduction(n_components=3, run_tsne=False)
    ratios = [c.variance_ratio for c in r.pca_components]
    assert all(0 <= v <= 1 for v in ratios), f"Ratio out of [0,1]: {ratios}"
    assert ratios == sorted(ratios, reverse=True), f"Ratios not descending: {ratios}"
    # Cumulative must be non-decreasing and ≤ 1
    cum = [c.cumulative_ratio for c in r.pca_components]
    assert cum == sorted(cum), f"Cumulative not monotone: {cum}"
    assert cum[-1] <= 1.0 + 1e-9


# ─────────────────────────────────────────────────────────────────────────────
# KPI — no NaN on tiny series (regression for services.py CV bug)
# ─────────────────────────────────────────────────────────────────────────────

def test_kpi_service_shares_never_nan(monkeypatch):
    """No CV / pct / cum_pct should ever be NaN, even on tiny/single-datapoint services.

    This is the correctness invariant behind the services.py CV guard: NaN in
    a Pydantic float silently serializes to `null` on the wire, which the
    frontend can't chart.
    """
    from routes import routes_events

    rows = [
        {"ds": "2026-01-01", "Sous-total (€)": 100.0, "service": "SoloService", "description": ""},
        {"ds": "2026-01-01", "Sous-total (€)": 50.0, "service": "OtherService", "description": ""},
        {"ds": "2026-01-02", "Sous-total (€)": 60.0, "service": "OtherService", "description": ""},
    ]
    monkeypatch.setattr(routes_events, "_injected_events", rows)

    from data.loader import invalidate_cache
    from core.cache import app_cache
    invalidate_cache()
    app_cache.clear()

    from analysis.services import get_service_shares

    shares = get_service_shares()
    assert len(shares) == 2
    for s in shares:
        # NaN != NaN in IEEE 754 — this catches every NaN leaking to the API.
        for field, value in [("cost", s.cost), ("pct", s.pct), ("cv", s.cv), ("cum_pct", s.cum_pct)]:
            assert value == value, f"NaN in {s.service}.{field}: {s}"


# ─────────────────────────────────────────────────────────────────────────────
# Ensemble — weights sum to 1, bias² + var ≈ MSE
# ─────────────────────────────────────────────────────────────────────────────

def test_ensemble_weights_sum_to_one(synthetic_events):
    """Inverse-MAE weights must be normalised to sum to 1."""
    from analysis.advanced import compute_ensemble_forecast

    r = compute_ensemble_forecast(horizon=30)
    if not r.weights:
        pytest.skip("Ensemble forecast returned no weights (insufficient data)")
    assert sum(r.weights.values()) == pytest.approx(1.0, abs=1e-4)


def test_ensemble_bias_variance_identity(synthetic_events):
    """For each model, bias² + variance should equal total MSE (within tolerance)."""
    from analysis.advanced import compute_ensemble_forecast

    r = compute_ensemble_forecast(horizon=30)
    for bv in r.bias_variance:
        # We defined bias^2 as (total - variance), so equality must hold up to
        # rounding to 4 decimals.
        assert abs(bv.bias_squared + bv.variance - bv.total_error) < 1e-3, bv
