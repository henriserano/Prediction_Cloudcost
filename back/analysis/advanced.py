"""Advanced statistical analyses on the daily cost series and per-service matrix.

Each public function returns a Pydantic schema (or list thereof) already
populated — the route layer just serializes them. All heavy sklearn imports
are done lazily inside the functions so the app can start without the
optional dependencies loaded eagerly.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

from data.loader import load_daily_costs, load_daily_per_service
from schemas.advanced import (
    BiasVarianceRow,
    DimReductionResponse,
    DistributionResponse,
    DriftResponse,
    EnsembleForecastPoint,
    EnsembleForecastResponse,
    GapRow,
    KSResult,
    MahalanobisRow,
    MissingnessResponse,
    NormalityTest,
    OutlierRow,
    OutlierSummary,
    OutliersResponse,
    PageHinkleyPoint,
    PCAComponent,
    PSIBin,
    PSIResult,
    ScaledSeriesPoint,
    ScalingResponse,
)


# ---------------------------------------------------------------------------
# Common helpers
# ---------------------------------------------------------------------------

def _daily_series() -> pd.DataFrame:
    df = load_daily_costs()
    if len(df) == 0 or "y" not in df.columns:
        return pd.DataFrame(columns=["ds", "y"])
    return df.sort_values("ds").reset_index(drop=True)


def _service_matrix() -> pd.DataFrame:
    df = load_daily_per_service()
    if len(df) == 0:
        return pd.DataFrame(columns=["ds"])
    return df.sort_values("ds").reset_index(drop=True)


# ---------------------------------------------------------------------------
# Outliers — Z, modified Z (MAD), IQR, Isolation Forest, LOF, Mahalanobis
# ---------------------------------------------------------------------------

def _mad_zscores(y: np.ndarray) -> np.ndarray:
    """Iglewicz-Hoaglin robust Z-score using the median absolute deviation.

    Constant 0.6745 makes MAD comparable to sigma on Gaussian data.
    """
    median = np.median(y)
    mad = np.median(np.abs(y - median))
    if mad == 0:
        return np.zeros_like(y, dtype=float)
    return 0.6745 * (y - median) / mad


def compute_outliers(z_thresh: float = 2.0, iqr_mult: float = 1.5) -> OutliersResponse:
    df = _daily_series()
    if len(df) < 5:
        return OutliersResponse(rows=[], summary=[], mahalanobis=[])

    y = df["y"].to_numpy(dtype=float)
    ds = df["ds"].dt.strftime("%Y-%m-%d").to_list()

    # 1. Standard Z-score
    mu, sigma = float(np.mean(y)), float(np.std(y, ddof=1))
    z = (y - mu) / sigma if sigma > 0 else np.zeros_like(y)

    # 2. Modified Z-score (MAD-based)
    mz = _mad_zscores(y)

    # 3. IQR / Tukey fences
    q1, q3 = np.percentile(y, [25, 75])
    iqr = q3 - q1
    iqr_low, iqr_high = q1 - iqr_mult * iqr, q3 + iqr_mult * iqr
    iqr_flag = (y < iqr_low) | (y > iqr_high)

    # 4. Isolation Forest + 5. LOF
    from sklearn.ensemble import IsolationForest
    from sklearn.neighbors import LocalOutlierFactor

    X = y.reshape(-1, 1)
    iso = IsolationForest(n_estimators=200, contamination="auto", random_state=42).fit(X)
    iso_score = -iso.score_samples(X)  # higher = more anomalous
    iso_flag = iso.predict(X) == -1

    # LOF n_neighbors defaults to 20; clamp so it never exceeds n-1
    n_neighbors = max(5, min(20, len(y) - 1))
    lof = LocalOutlierFactor(n_neighbors=n_neighbors)
    lof_pred = lof.fit_predict(X)
    lof_score = -lof.negative_outlier_factor_
    lof_flag = lof_pred == -1

    rows = [
        OutlierRow(
            date=ds[i],
            cost=round(float(y[i]), 4),
            zscore=round(float(z[i]), 4),
            modified_zscore=round(float(mz[i]), 4),
            iqr_flag=bool(iqr_flag[i]),
            isolation_score=round(float(iso_score[i]), 4),
            isolation_flag=bool(iso_flag[i]),
            lof_score=round(float(lof_score[i]), 4),
            lof_flag=bool(lof_flag[i]),
        )
        for i in range(len(y))
    ]

    n = len(y)
    summary = [
        OutlierSummary(method="zscore", flagged_count=int(np.sum(np.abs(z) > z_thresh)),
                       flagged_pct=round(float(np.mean(np.abs(z) > z_thresh) * 100), 2),
                       threshold=z_thresh),
        OutlierSummary(method="modified_zscore", flagged_count=int(np.sum(np.abs(mz) > 3.5)),
                       flagged_pct=round(float(np.mean(np.abs(mz) > 3.5) * 100), 2),
                       threshold=3.5),
        OutlierSummary(method="iqr", flagged_count=int(np.sum(iqr_flag)),
                       flagged_pct=round(float(np.mean(iqr_flag) * 100), 2),
                       threshold=iqr_mult),
        OutlierSummary(method="isolation_forest", flagged_count=int(np.sum(iso_flag)),
                       flagged_pct=round(float(np.mean(iso_flag) * 100), 2)),
        OutlierSummary(method="lof", flagged_count=int(np.sum(lof_flag)),
                       flagged_pct=round(float(np.mean(lof_flag) * 100), 2)),
    ]

    # 6. Mahalanobis on the per-service cost matrix
    mahalanobis = _mahalanobis_outliers()

    return OutliersResponse(rows=rows, summary=summary, mahalanobis=mahalanobis)


def _mahalanobis_outliers() -> list[MahalanobisRow]:
    """Robust Mahalanobis distance on the per-service matrix.

    Uses the Minimum Covariance Determinant estimator to avoid the covariance
    matrix being pulled by the very outliers we are trying to detect.
    """
    svc = _service_matrix()
    cols = [c for c in svc.columns if c != "ds"]
    if len(cols) < 2 or len(svc) < 10:
        return []

    X = svc[cols].to_numpy(dtype=float)
    if X.shape[0] <= X.shape[1] + 1:
        return []

    try:
        from sklearn.covariance import MinCovDet
        from scipy.stats import chi2

        mcd = MinCovDet(support_fraction=None, random_state=42).fit(X)
        dist = mcd.mahalanobis(X)
        p_values = 1 - chi2.cdf(dist, df=X.shape[1])
        threshold = chi2.ppf(0.975, df=X.shape[1])
    except Exception:
        return []

    ds = svc["ds"].dt.strftime("%Y-%m-%d").to_list()
    return [
        MahalanobisRow(
            date=ds[i],
            distance=round(float(dist[i]), 4),
            p_value=round(float(p_values[i]), 6),
            is_outlier=bool(dist[i] > threshold),
        )
        for i in range(len(dist))
    ]


# ---------------------------------------------------------------------------
# Drift — KS test, PSI, Page-Hinkley
# ---------------------------------------------------------------------------

def compute_drift(reference_frac: float = 0.5, psi_bins: int = 10) -> DriftResponse:
    df = _daily_series()
    y = df["y"].to_numpy(dtype=float) if len(df) else np.array([])
    if len(y) < 30:
        return DriftResponse(
            ks=KSResult(statistic=0, p_value=1, drift_detected=False,
                        reference_period="", current_period="",
                        n_ref=0, n_cur=0),
            psi=PSIResult(psi=0.0, verdict="insufficient-data", bins=[]),
            page_hinkley=[],
            n_changepoints_detected=0,
        )

    ds = df["ds"].dt.strftime("%Y-%m-%d").to_list()
    split = int(len(y) * reference_frac)
    ref, cur = y[:split], y[split:]

    # 1. Kolmogorov-Smirnov two-sample test
    from scipy.stats import ks_2samp

    ks_stat, ks_p = ks_2samp(ref, cur)
    ks = KSResult(
        statistic=round(float(ks_stat), 6),
        p_value=round(float(ks_p), 6),
        drift_detected=bool(ks_p < 0.05),
        reference_period=f"{ds[0]} → {ds[split-1]}",
        current_period=f"{ds[split]} → {ds[-1]}",
        n_ref=int(len(ref)),
        n_cur=int(len(cur)),
    )

    # 2. Population Stability Index — bin edges from the reference quantiles,
    # extended to ±∞ so that current-window values outside the reference range
    # are still counted (otherwise np.histogram drops them and PSI silently
    # under-reports drift on mean shifts). Laplace smoothing prevents log(0).
    inner_edges = np.unique(np.quantile(ref, np.linspace(0, 1, psi_bins + 1)))
    if len(inner_edges) < 2:
        # Reference is a single value — PSI is mathematically undefined.
        psi = PSIResult(psi=0.0, verdict="insufficient-data", bins=[])
    else:
        edges = np.concatenate([[-np.inf], inner_edges[1:-1], [np.inf]])
        ref_hist, _ = np.histogram(ref, bins=edges)
        cur_hist, _ = np.histogram(cur, bins=edges)
        eps = 1e-6
        ref_pct = (ref_hist + eps) / (ref_hist.sum() + eps * len(ref_hist))
        cur_pct = (cur_hist + eps) / (cur_hist.sum() + eps * len(cur_hist))
        contributions = (cur_pct - ref_pct) * np.log(cur_pct / ref_pct)
        psi_value = float(contributions.sum())
        if psi_value < 0.1:
            verdict = "stable"
        elif psi_value < 0.25:
            verdict = "moderate"
        else:
            verdict = "significant"
        # Present ±∞ edges to callers as the actual data extrema so the payload
        # stays JSON-serializable and readable.
        display_edges = edges.copy()
        display_edges[0] = float(min(np.min(ref), np.min(cur)))
        display_edges[-1] = float(max(np.max(ref), np.max(cur)))
        bins = [
            PSIBin(
                lower=round(float(display_edges[i]), 4),
                upper=round(float(display_edges[i + 1]), 4),
                ref_pct=round(float(ref_pct[i]) * 100, 2),
                cur_pct=round(float(cur_pct[i]) * 100, 2),
                contribution=round(float(contributions[i]), 6),
            )
            for i in range(len(edges) - 1)
        ]
        psi = PSIResult(psi=round(psi_value, 6), verdict=verdict, bins=bins)

    # 3. Page-Hinkley test — online detection of a mean shift
    # PH statistic: m_t = sum_{i<=t} (x_i - mean_i - delta); alarm if m_t - min(m) > lambda
    delta = 0.005 * float(np.mean(y))
    threshold = 5.0 * float(np.std(y))
    mean_running = 0.0
    m_t = 0.0
    m_min = 0.0
    ph_points: list[PageHinkleyPoint] = []
    n_changes = 0
    for i, val in enumerate(y):
        n = i + 1
        mean_running = mean_running + (val - mean_running) / n
        m_t += val - mean_running - delta
        m_min = min(m_min, m_t)
        gap = m_t - m_min
        detected = gap > threshold
        if detected:
            n_changes += 1
        ph_points.append(
            PageHinkleyPoint(
                date=ds[i], ph_stat=round(float(gap), 4), change_detected=detected
            )
        )

    return DriftResponse(
        ks=ks,
        psi=psi,
        page_hinkley=ph_points,
        n_changepoints_detected=n_changes,
    )


# ---------------------------------------------------------------------------
# Distribution — skew/kurtosis, Box-Cox, normality tests, QQ
# ---------------------------------------------------------------------------

def compute_distribution() -> DistributionResponse:
    from scipy import stats

    df = _daily_series()
    y = df["y"].to_numpy(dtype=float) if len(df) else np.array([])
    if len(y) < 10:
        return DistributionResponse(
            skewness=0.0, kurtosis=0.0, boxcox_lambda=None,
            normality_tests=[], qq_points=[],
        )

    # Constant / near-constant series (very common right after a simulation
    # push where every day of a month carries the same amount) makes scipy
    # spam RuntimeWarning: "catastrophic cancellation" and return NaN. Skew
    # and excess kurtosis are 0 by definition on a strictly constant signal —
    # short-circuit so we don't leak NaN downstream nor pollute the logs.
    if float(np.std(y, ddof=1)) < 1e-12:
        skew = 0.0
        kurt = 0.0
    else:
        skew = float(stats.skew(y, bias=False))
        kurt = float(stats.kurtosis(y, bias=False))  # excess kurtosis

    # Box-Cox needs strictly positive values
    boxcox_lambda: Optional[float] = None
    if np.all(y > 0):
        try:
            _, boxcox_lambda = stats.boxcox(y)
            boxcox_lambda = round(float(boxcox_lambda), 4)
        except Exception:
            boxcox_lambda = None

    tests: list[NormalityTest] = []

    # Jarque-Bera (asymptotic, good for n > 2000, informative for smaller)
    jb_stat, jb_p = stats.jarque_bera(y)
    tests.append(NormalityTest(
        name="jarque_bera",
        statistic=round(float(jb_stat), 6),
        p_value=round(float(jb_p), 6),
        is_normal=bool(jb_p > 0.05),
    ))

    # Shapiro-Wilk (best for n < 5000)
    if len(y) <= 5000:
        sh_stat, sh_p = stats.shapiro(y)
        tests.append(NormalityTest(
            name="shapiro_wilk",
            statistic=round(float(sh_stat), 6),
            p_value=round(float(sh_p), 6),
            is_normal=bool(sh_p > 0.05),
        ))

    # D'Agostino K^2
    da_stat, da_p = stats.normaltest(y)
    tests.append(NormalityTest(
        name="dagostino_k2",
        statistic=round(float(da_stat), 6),
        p_value=round(float(da_p), 6),
        is_normal=bool(da_p > 0.05),
    ))

    # QQ points — theoretical vs sample quantiles
    theoretical = stats.norm.ppf(np.linspace(0.01, 0.99, min(50, len(y))))
    sample = np.quantile(y, np.linspace(0.01, 0.99, min(50, len(y))))
    qq_points = [[round(float(t), 6), round(float(s), 6)] for t, s in zip(theoretical, sample)]

    return DistributionResponse(
        skewness=round(skew, 6),
        kurtosis=round(kurt, 6),
        boxcox_lambda=boxcox_lambda,
        normality_tests=tests,
        qq_points=qq_points,
    )


# ---------------------------------------------------------------------------
# Scaling comparison — StandardScaler vs MinMaxScaler vs RobustScaler
# ---------------------------------------------------------------------------

def compute_scaling() -> ScalingResponse:
    df = _daily_series()
    if len(df) == 0 or "y" not in df.columns:
        return ScalingResponse(points=[], stats={})

    y = df["y"].to_numpy(dtype=float)
    ds = df["ds"].dt.strftime("%Y-%m-%d").to_list()

    mean_ = float(np.mean(y))
    std_ = float(np.std(y, ddof=1)) or 1.0
    min_, max_ = float(np.min(y)), float(np.max(y))
    range_ = (max_ - min_) or 1.0
    median = float(np.median(y))
    q1, q3 = float(np.percentile(y, 25)), float(np.percentile(y, 75))
    iqr = (q3 - q1) or 1.0

    standard = (y - mean_) / std_
    minmax = (y - min_) / range_
    robust = (y - median) / iqr

    points = [
        ScaledSeriesPoint(
            date=ds[i],
            standard=round(float(standard[i]), 6),
            minmax=round(float(minmax[i]), 6),
            robust=round(float(robust[i]), 6),
        )
        for i in range(len(y))
    ]

    stats_dict = {
        "standard": {"mean": round(mean_, 4), "std": round(std_, 4)},
        "minmax": {"min": round(min_, 4), "max": round(max_, 4)},
        "robust": {"median": round(median, 4), "iqr": round(iqr, 4)},
    }
    return ScalingResponse(points=points, stats=stats_dict)


# ---------------------------------------------------------------------------
# Missing data — gaps, per-service missing %, MCAR/MAR/MNAR hint
# ---------------------------------------------------------------------------

def compute_missingness() -> MissingnessResponse:
    df = _daily_series()
    if len(df) < 5:
        return MissingnessResponse(
            calendar_days_expected=0, actual_days=0, missing_days=0,
            gaps=[], per_service_missing_pct={},
            mechanism_hint="insufficient-data",
        )

    start, end = df["ds"].min(), df["ds"].max()
    calendar = pd.date_range(start=start, end=end, freq="D")
    present = pd.DatetimeIndex(df["ds"])
    missing_dates = calendar.difference(present)

    gaps: list[GapRow] = []
    if len(missing_dates) > 0:
        # Group consecutive missing dates into ranges
        d = pd.Series(missing_dates)
        groups = (d.diff().dt.days.fillna(1) != 1).cumsum()
        for _, g in d.groupby(groups):
            gaps.append(GapRow(
                start=g.iloc[0].strftime("%Y-%m-%d"),
                end=g.iloc[-1].strftime("%Y-%m-%d"),
                days=int(len(g)),
            ))

    # Compute per-service missing rate using the RAW events store (not the
    # zero-filled pivot). A day where a service has no row in the raw store
    # is genuinely missing observation; a day where it appears with cost 0
    # is a legitimate zero, not missing data.
    per_service_missing_pct: dict[str, float] = {}
    try:
        from routes.routes_events import get_injected_events_df

        events_df = get_injected_events_df()
    except Exception:
        events_df = pd.DataFrame()

    if len(events_df) > 0 and "service" in events_df.columns:
        n_calendar = len(calendar)
        for svc_name, grp in events_df.groupby("service"):
            observed_days = grp["ds"].dt.normalize().nunique()
            missing_frac = 1.0 - (observed_days / n_calendar) if n_calendar else 0.0
            per_service_missing_pct[str(svc_name)] = round(max(0.0, missing_frac) * 100, 2)
    else:
        # Fallback when raw events are unavailable (e.g., analytics running off
        # parquet). Skip the per-service field rather than reporting incorrect
        # numbers from a zero-filled pivot.
        per_service_missing_pct = {}

    # Mechanism hint — a coarse heuristic based on where calendar gaps fall:
    #  MCAR-like:  no calendar gaps at all
    #  MNAR-like:  gap days concentrate below the 25th percentile of cost
    #              (values missing because they were low → depends on the value)
    #  MAR-like:   gaps exist but do not concentrate in a specific cost regime
    y = df["y"].to_numpy(dtype=float)
    if len(missing_dates) == 0:
        hint = "MCAR-like"
    elif len(y) >= 4:
        # Use the observed distribution to infer whether missing days would
        # have been low-cost (MNAR) — we approximate the missing day cost by
        # the average of its neighbours in time.
        full = pd.DataFrame({"ds": calendar}).merge(df, on="ds", how="left")
        full["neighbor_est"] = full["y"].interpolate(method="linear", limit_direction="both")
        low_thresh = np.percentile(y, 25)
        missing_mask = full["y"].isna()
        if missing_mask.sum() > 0:
            imputed_costs = full.loc[missing_mask, "neighbor_est"].to_numpy(dtype=float)
            frac_low = float(np.mean(imputed_costs < low_thresh))
            hint = "MNAR-like" if frac_low > 0.7 else "MAR-like"
        else:
            hint = "MCAR-like"
    else:
        hint = "insufficient-data"

    return MissingnessResponse(
        calendar_days_expected=int(len(calendar)),
        actual_days=int(len(present)),
        missing_days=int(len(missing_dates)),
        gaps=gaps,
        per_service_missing_pct=per_service_missing_pct,
        mechanism_hint=hint,
    )


# ---------------------------------------------------------------------------
# Dimensionality reduction — PCA + t-SNE on per-service matrix
# ---------------------------------------------------------------------------

def compute_dim_reduction(n_components: int = 5, run_tsne: bool = True) -> DimReductionResponse:
    svc = _service_matrix()
    cols = [c for c in svc.columns if c != "ds"]
    if len(cols) < 3 or len(svc) < 10:
        return DimReductionResponse(
            n_services=len(cols), n_days=len(svc),
            pca_components=[], total_variance_explained=0.0, tsne_2d=[],
        )

    from sklearn.decomposition import PCA
    from sklearn.preprocessing import StandardScaler

    # Rows = days, columns = services. We reduce over the services axis to
    # find which services drive variance in total spend.
    X = svc[cols].to_numpy(dtype=float)

    # StandardScaler happily divides by zero on constant columns (typical
    # right after a simulation push where each service is a flat value).
    # Detect that up-front and return an empty PCA response so downstream
    # /api/analysis/dim-reduction stays green instead of pushing NaNs into
    # explained_variance_ratio_ (which then sklearn divides by zero on).
    col_variances = np.var(X, axis=0, ddof=1)
    if not np.any(col_variances > 1e-12):
        return DimReductionResponse(
            n_services=len(cols), n_days=len(svc),
            pca_components=[], total_variance_explained=0.0, tsne_2d=[],
        )

    X_scaled = StandardScaler().fit_transform(X)

    n_components = min(n_components, X.shape[1], X.shape[0])
    pca = PCA(n_components=n_components).fit(X_scaled)

    components: list[PCAComponent] = []
    cumulative = 0.0
    for i in range(n_components):
        var_ratio = float(pca.explained_variance_ratio_[i])
        cumulative += var_ratio
        loadings = pca.components_[i]
        pairs = sorted(
            zip(cols, loadings), key=lambda kv: abs(kv[1]), reverse=True
        )[:5]
        components.append(
            PCAComponent(
                component=i + 1,
                variance_ratio=round(var_ratio, 6),
                cumulative_ratio=round(cumulative, 6),
                top_loadings={svc_name: round(float(load), 4) for svc_name, load in pairs},
            )
        )

    # t-SNE on the transposed matrix (services in 2D) so we can plot service
    # clusters. Skip when we have too few services to be meaningful.
    tsne_2d: list[dict] = []
    if run_tsne and len(cols) >= 4:
        try:
            from sklearn.manifold import TSNE

            perplexity = max(2, min(30, len(cols) - 1))
            # sklearn ≥ 1.5 renamed `n_iter` → `max_iter`; feature-detect so the
            # code stays compatible with both APIs.
            tsne_kwargs = dict(
                n_components=2,
                perplexity=perplexity,
                init="pca",
                random_state=42,
            )
            import inspect
            if "max_iter" in inspect.signature(TSNE).parameters:
                tsne_kwargs["max_iter"] = 500
            else:
                tsne_kwargs["n_iter"] = 500
            embed = TSNE(**tsne_kwargs).fit_transform(X_scaled.T)
            tsne_2d = [
                {"service": cols[i], "x": round(float(embed[i, 0]), 4),
                 "y": round(float(embed[i, 1]), 4)}
                for i in range(len(cols))
            ]
        except Exception:
            tsne_2d = []

    return DimReductionResponse(
        n_services=len(cols),
        n_days=len(svc),
        pca_components=components,
        total_variance_explained=round(cumulative, 6),
        tsne_2d=tsne_2d,
    )


# ---------------------------------------------------------------------------
# Ensemble forecast + bias/variance decomposition
# ---------------------------------------------------------------------------

def compute_ensemble_forecast(horizon: int = 60) -> EnsembleForecastResponse:
    from forecast.engine import MODELS

    df = _daily_series()
    if len(df) < 60:
        return EnsembleForecastResponse(
            horizon=horizon, base_models=list(MODELS.keys()), weights={},
            points=[], bias_variance=[],
        )

    y = df["y"].to_numpy(dtype=float)
    dates = df["ds"].tolist()

    # Fit each model on the full history + collect CV-based errors
    forecasts: dict[str, np.ndarray] = {}
    cv_maes: dict[str, float] = {}
    cv_preds: dict[str, list[np.ndarray]] = {}
    cv_trues: list[np.ndarray] = []

    n = len(y)
    h_cv = 14
    n_splits = 5
    min_train = max(30, n - n_splits * h_cv)

    # Collect CV predictions per model on the same folds
    fold_ranges = []
    for i in range(n_splits):
        split = min_train + i * h_cv
        if split + h_cv > n:
            break
        fold_ranges.append((split, split + h_cv))

    for split, end in fold_ranges:
        cv_trues.append(y[split:end])

    for name, (_, fn) in MODELS.items():
        try:
            forecast, _, _ = fn(y, horizon)
            forecasts[name] = np.array(forecast)
        except Exception:
            forecasts[name] = np.full(horizon, float(np.mean(y)))

        preds_fold: list[np.ndarray] = []
        for split, end in fold_ranges:
            try:
                p, _, _ = fn(y[:split], h_cv)
                preds_fold.append(np.array(p[:h_cv]))
            except Exception:
                preds_fold.append(np.full(h_cv, float(np.mean(y[:split]))))
        cv_preds[name] = preds_fold

        errs = [
            float(np.mean(np.abs(cv_trues[i] - preds_fold[i])))
            for i in range(len(cv_trues))
        ]
        cv_maes[name] = float(np.mean(errs)) if errs else float("inf")

    # Weighted ensemble — inverse-MAE weights normalised to sum to 1
    inv = {k: (1.0 / v if v > 0 else 0.0) for k, v in cv_maes.items()}
    tot = sum(inv.values()) or 1.0
    weights = {k: round(v / tot, 6) for k, v in inv.items()}

    # Assemble future predictions
    stacked = np.vstack(list(forecasts.values()))
    mean_pred = np.mean(stacked, axis=0)

    weight_arr = np.array([weights[k] for k in forecasts.keys()])
    weighted_pred = np.average(stacked, axis=0, weights=weight_arr)

    # 80% band from cross-model dispersion — a rough interval showing the
    # spread of the ensemble members at each horizon.
    lo = np.percentile(stacked, 10, axis=0)
    hi = np.percentile(stacked, 90, axis=0)

    # Normalise to midnight so future dates don't carry over intra-day drift
    # if the ingested data was ever tagged with a non-midnight timestamp.
    last_date = pd.Timestamp(dates[-1]).normalize()
    future_dates = pd.date_range(last_date + pd.Timedelta(days=1), periods=horizon, freq="D")

    points = [
        EnsembleForecastPoint(
            date=future_dates[i].strftime("%Y-%m-%d"),
            actual=None,
            mean_ensemble=round(float(mean_pred[i]), 4),
            weighted_ensemble=round(float(weighted_pred[i]), 4),
            lo80=round(float(lo[i]), 4),
            hi80=round(float(hi[i]), 4),
        )
        for i in range(horizon)
    ]

    # Bias-variance decomposition on the CV folds, computed per fold and then
    # averaged so that bias reflects per-fold prediction quality and variance
    # reflects instability of the prediction across folds relative to the same
    # test target — not variability across different test folds' true values.
    #
    # For each fold f (true = y_f, pred = p_f), we compute the residual r_f =
    # (p_f - y_f). Total MSE = mean(r_f^2). Variance is the across-fold
    # variance of residuals at each step, then averaged. Bias^2 = MSE - Var.
    bv: list[BiasVarianceRow] = []
    if cv_trues:
        true_stack = np.vstack(cv_trues)  # (n_folds, h_cv)
        for name, preds_fold in cv_preds.items():
            preds_stack = np.vstack(preds_fold)  # (n_folds, h_cv)
            residuals = preds_stack - true_stack  # (n_folds, h_cv)
            total = float(np.mean(residuals ** 2))
            # Variance of the residual across folds (per step), averaged
            var = float(np.mean(np.var(residuals, axis=0)))
            # Bias^2 as the remainder; clamp non-negative to guard against
            # tiny numerical negatives from floating-point subtraction.
            bias_sq = max(0.0, total - var)
            bv.append(
                BiasVarianceRow(
                    model=name,
                    bias_squared=round(bias_sq, 4),
                    variance=round(var, 4),
                    total_error=round(total, 4),
                )
            )
    bv.sort(key=lambda r: r.total_error)

    return EnsembleForecastResponse(
        horizon=horizon,
        base_models=list(MODELS.keys()),
        weights=weights,
        points=points,
        bias_variance=bv,
    )
