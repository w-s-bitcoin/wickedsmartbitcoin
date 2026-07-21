#!/usr/bin/env python3
"""Assign a model-based confidence score to blocks marked by `patoshi_updated`.

The score is a leave-one-out, trajectory-aware probability estimate.  It uses:

1. Support for a Patoshi extranonce trajectory through the candidate.
2. Support for a competing non-Patoshi trajectory through the candidate.
3. The local density of non-Patoshi blocks.
4. Whether the strongest competing trajectory is mostly spent or unspent.
5. The candidate's own spent/unspent state, expressed as an empirical-Bayes
   likelihood ratio rather than as a hard rule.

Trajectory support is estimated with a local Hough transform.  Every nearby
block votes for the positive extranonce/time slope of a line passing through
 the candidate.  Concentrated votes indicate a real extranonce line rather
than accidental proximity.  Votes are time-decayed and receive an additional
bonus when the same slope has support on both sides of the candidate.

The component features are mapped to [0, 1] with a cross-fitted, weighted
logistic regression.  The cross-fitted probability for each Patoshi-labelled
block is used as its confidence, so the candidate's own label is not used to
fit the model that scores it.

Important interpretation: this is an internally calibrated confidence score
relative to the supplied `patoshi_updated` classification and this dataset.
It is not an independently verified probability that Satoshi mined a block.

Dependencies: numpy, scipy, scikit-learn
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

import numpy as np
from scipy.ndimage import gaussian_filter1d
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import StratifiedKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


EPS = 1e-12
KNOWN_SATOSHI_CONFIDENCE_HEIGHTS = {
    0,  # Genesis block.
    9,  # Coinbase spent in block 170 for the Hal Finney payment.
    5326,  # Coinbase spent in block 11408 for the Mike Hearn payment.
}


@dataclass
class Config:
    label_column: str = "patoshi_updated"
    output_column: str = "patoshi_confidence"
    window_days: float = 12.0
    time_decay_days: float = 4.0
    min_time_gap_days: float = 10.0 / 1440.0  # 10 minutes
    max_slope_per_day: float = 6000.0
    slope_bin_width: float = 20.0
    slope_smoothing_bins: float = 1.25
    bilateral_bonus: float = 0.65
    competing_line_half_width_bins: int = 3
    line_residual_tolerance: float = 24.0
    spend_prior_strength: float = 6.0
    negative_to_positive_ratio: float = 1.5
    time_stratum_days: float = 7.0
    cv_folds: int = 5
    random_seed: int = 110
    write_diagnostics: bool = False


@dataclass
class SourceSeries:
    times: np.ndarray
    extranonces: np.ndarray
    spent: np.ndarray


@dataclass
class HoughResult:
    peak_excess: float
    peak_ratio: float
    bilateral_balance: float
    density_per_day: float
    best_slope: float
    line_count: int
    line_spent_count: int
    line_unspent_count: int


def _parse_binary(value: str) -> int:
    try:
        return 1 if int(float(value)) != 0 else 0
    except (TypeError, ValueError):
        return 0


def _parse_height(row: Dict[str, str]) -> int | None:
    try:
        return int(str(row.get("height", "")).strip())
    except (TypeError, ValueError):
        return None


def read_csv(path: Path, cfg: Config) -> Tuple[List[str], List[Dict[str, str]], np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    with path.open("r", newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise ValueError("Input CSV has no header row.")
        required = {"timestamp", "extranonce", "is_spent", cfg.label_column}
        missing = required.difference(reader.fieldnames)
        if missing:
            raise ValueError(f"Missing required columns: {sorted(missing)}")
        fieldnames = list(reader.fieldnames)
        rows = list(reader)

    timestamps = np.asarray([float(r["timestamp"]) for r in rows], dtype=np.float64)
    times = (timestamps - np.nanmin(timestamps)) / 86400.0
    extranonces = np.asarray([float(r["extranonce"]) for r in rows], dtype=np.float64)
    spent = np.asarray([_parse_binary(r["is_spent"]) for r in rows], dtype=np.int8)
    labels = np.asarray([_parse_binary(r[cfg.label_column]) for r in rows], dtype=np.int8)
    return fieldnames, rows, times, extranonces, spent, labels


def make_source(indices: np.ndarray, times: np.ndarray, extranonces: np.ndarray, spent: np.ndarray) -> SourceSeries:
    order = indices[np.argsort(times[indices], kind="mergesort")]
    return SourceSeries(times=times[order], extranonces=extranonces[order], spent=spent[order])


def local_hough(
    query_time: float,
    query_extranonce: float,
    source: SourceSeries,
    cfg: Config,
) -> HoughResult:
    """Estimate the strongest positive-slope source trajectory through a point."""
    left = int(np.searchsorted(source.times, query_time - cfg.window_days, side="left"))
    right = int(np.searchsorted(source.times, query_time + cfg.window_days, side="right"))

    available_left = min(cfg.window_days, max(0.0, query_time - float(source.times[0]))) if source.times.size else 0.0
    available_right = min(cfg.window_days, max(0.0, float(source.times[-1]) - query_time)) if source.times.size else 0.0
    available_days = max(available_left + available_right, cfg.window_days)

    if right <= left:
        return HoughResult(0.0, 1.0, 0.0, 0.0, 0.0, 0, 0, 0)

    t = source.times[left:right]
    x = source.extranonces[left:right]
    s = source.spent[left:right]
    dt = t - query_time
    dx = x - query_extranonce

    valid = np.abs(dt) >= cfg.min_time_gap_days
    # Extranonce lines advance with time, so a plausible crossing has dx/dt >= 0.
    slopes = np.empty_like(dt)
    slopes.fill(np.nan)
    slopes[valid] = dx[valid] / dt[valid]
    valid &= slopes >= 0.0
    valid &= slopes <= cfg.max_slope_per_day

    local_count = int(np.count_nonzero(np.abs(dt) >= cfg.min_time_gap_days))
    density = local_count / max(available_days, EPS)

    if not np.any(valid):
        return HoughResult(0.0, 1.0, 0.0, density, 0.0, 0, 0, 0)

    dtv = dt[valid]
    slopev = slopes[valid]
    spentv = s[valid]
    n_bins = int(math.ceil(cfg.max_slope_per_day / cfg.slope_bin_width)) + 1
    bins = np.floor(slopev / cfg.slope_bin_width).astype(np.int32)
    bins = np.clip(bins, 0, n_bins - 1)
    weights = np.exp(-np.abs(dtv) / cfg.time_decay_days)

    total = np.bincount(bins, weights=weights, minlength=n_bins).astype(np.float64)
    before = np.bincount(bins[dtv < 0], weights=weights[dtv < 0], minlength=n_bins).astype(np.float64)
    after = np.bincount(bins[dtv > 0], weights=weights[dtv > 0], minlength=n_bins).astype(np.float64)

    if cfg.slope_smoothing_bins > 0:
        total = gaussian_filter1d(total, cfg.slope_smoothing_bins, mode="nearest")
        before = gaussian_filter1d(before, cfg.slope_smoothing_bins, mode="nearest")
        after = gaussian_filter1d(after, cfg.slope_smoothing_bins, mode="nearest")

    bilateral = 2.0 * np.sqrt(before * after)
    objective = total + cfg.bilateral_bonus * bilateral
    best_bin = int(np.argmax(objective))

    # The median is a robust estimate of diffuse/background Hough votes.
    background_total = float(np.median(total))
    background_objective = background_total
    peak_excess = max(0.0, float(objective[best_bin]) - background_objective)
    peak_ratio = (float(objective[best_bin]) + 0.05) / (background_objective + 0.05)
    balance = float(bilateral[best_bin] / (total[best_bin] + EPS))
    balance = min(max(balance, 0.0), 1.0)

    # Refine the coarse Hough slope and then evaluate support in a fixed-width
    # extranonce tube.  A fixed residual tolerance avoids treating an ever-wider
    # wedge as one line at long time distances.
    best_slope = (best_bin + 0.5) * cfg.slope_bin_width
    coarse_half_width = cfg.competing_line_half_width_bins * cfg.slope_bin_width
    coarse = np.abs(slopev - best_slope) <= coarse_half_width
    if np.count_nonzero(coarse) >= 2:
        wc = weights[coarse]
        dc = dtv[coarse]
        xc = (slopev[coarse] * dc)
        denom = float(np.sum(wc * dc * dc))
        if denom > EPS:
            best_slope = float(np.sum(wc * dc * xc) / denom)

    for _ in range(2):
        residual = (slopev * dtv) - best_slope * dtv
        on_line = np.abs(residual) <= cfg.line_residual_tolerance
        if np.count_nonzero(on_line) < 2:
            break
        wl = weights[on_line]
        dl = dtv[on_line]
        xl = slopev[on_line] * dl
        denom = float(np.sum(wl * dl * dl))
        if denom <= EPS:
            break
        best_slope = float(np.sum(wl * dl * xl) / denom)

    residual = (slopev * dtv) - best_slope * dtv
    on_line = np.abs(residual) <= cfg.line_residual_tolerance
    residual_kernel = np.exp(-0.5 * (residual / cfg.line_residual_tolerance) ** 2)
    refined_weights = weights * residual_kernel * on_line
    refined_total = float(np.sum(refined_weights))
    refined_before = float(np.sum(refined_weights[dtv < 0]))
    refined_after = float(np.sum(refined_weights[dtv > 0]))
    refined_bilateral = 2.0 * math.sqrt(refined_before * refined_after)
    refined_objective = refined_total + cfg.bilateral_bonus * refined_bilateral

    # Keep the background-subtracted coarse peak as a floor, but use the
    # fixed-width refined support whenever it is stronger.
    peak_excess = max(peak_excess, refined_objective)
    balance = refined_bilateral / (refined_total + EPS)
    balance = min(max(balance, 0.0), 1.0)

    line_count = int(np.count_nonzero(on_line))
    line_spent_count = int(np.count_nonzero(spentv[on_line] == 1))
    line_unspent_count = line_count - line_spent_count

    return HoughResult(
        peak_excess=peak_excess,
        peak_ratio=peak_ratio,
        bilateral_balance=balance,
        density_per_day=density,
        best_slope=best_slope,
        line_count=line_count,
        line_spent_count=line_spent_count,
        line_unspent_count=line_unspent_count,
    )


def stratified_negative_sample(labels: np.ndarray, times: np.ndarray, cfg: Config) -> Tuple[np.ndarray, np.ndarray]:
    """Take time-matched negatives and return indices plus prevalence weights."""
    rng = np.random.default_rng(cfg.random_seed)
    positives = np.flatnonzero(labels == 1)
    negatives = np.flatnonzero(labels == 0)
    strata = np.floor(times / cfg.time_stratum_days).astype(np.int64)

    chosen: List[int] = []
    weights: List[float] = []

    # All positives are retained with unit weight.
    chosen.extend(positives.tolist())
    weights.extend([1.0] * positives.size)

    for stratum in np.unique(strata[positives]):
        p_idx = positives[strata[positives] == stratum]
        n_idx = negatives[strata[negatives] == stratum]
        if n_idx.size == 0:
            continue
        target = max(1, int(math.ceil(cfg.negative_to_positive_ratio * p_idx.size)))
        take = min(target, n_idx.size)
        sample = rng.choice(n_idx, size=take, replace=False)
        # Weight sampled negatives back to their original stratum count.
        neg_weight = n_idx.size / take
        chosen.extend(sample.tolist())
        weights.extend([float(neg_weight)] * take)

    chosen_arr = np.asarray(chosen, dtype=np.int64)
    weight_arr = np.asarray(weights, dtype=np.float64)
    order = np.argsort(chosen_arr, kind="mergesort")
    return chosen_arr[order], weight_arr[order]


def compute_features(
    query_indices: np.ndarray,
    times: np.ndarray,
    extranonces: np.ndarray,
    spent: np.ndarray,
    labels: np.ndarray,
    cfg: Config,
) -> Tuple[np.ndarray, List[Dict[str, float]]]:
    pos_source = make_source(np.flatnonzero(labels == 1), times, extranonces, spent)
    neg_source = make_source(np.flatnonzero(labels == 0), times, extranonces, spent)

    # Empirical-Bayes reference probability for Patoshi blocks.
    p_pat_unspent = (float(np.count_nonzero((labels == 1) & (spent == 0))) + 1.0) / (float(np.count_nonzero(labels == 1)) + 2.0)
    p_neg_unspent_global = (float(np.count_nonzero((labels == 0) & (spent == 0))) + 1.0) / (float(np.count_nonzero(labels == 0)) + 2.0)

    features: List[List[float]] = []
    diagnostics: List[Dict[str, float]] = []

    for counter, idx in enumerate(query_indices, start=1):
        p = local_hough(times[idx], extranonces[idx], pos_source, cfg)
        o = local_hough(times[idx], extranonces[idx], neg_source, cfg)

        # Competing-line spend probability, shrunk toward the global non-pattern rate.
        alpha = 1.0 + cfg.spend_prior_strength * p_neg_unspent_global
        beta = 1.0 + cfg.spend_prior_strength * (1.0 - p_neg_unspent_global)
        p_o_unspent = (o.line_unspent_count + alpha) / (o.line_count + alpha + beta)

        if spent[idx] == 0:
            spend_bf = math.log(max(p_pat_unspent, EPS) / max(p_o_unspent, EPS))
        else:
            spend_bf = math.log(max(1.0 - p_pat_unspent, EPS) / max(1.0 - p_o_unspent, EPS))
        spend_bf = float(np.clip(spend_bf, -6.0, 6.0))

        p_peak = p.peak_excess
        o_peak = o.peak_excess
        peak_log_ratio = math.log((p_peak + 0.25) / (o_peak + 0.25))
        density_log_ratio = math.log((p.density_per_day + 0.05) / (o.density_per_day + 0.05))

        row_features = [
            math.log1p(p_peak),
            math.log1p(o_peak),
            math.log(max(p.peak_ratio, EPS)),
            math.log(max(o.peak_ratio, EPS)),
            p.bilateral_balance,
            o.bilateral_balance,
            math.log1p(p.density_per_day),
            math.log1p(o.density_per_day),
            peak_log_ratio,
            density_log_ratio,
            spend_bf,
            math.log1p(o.line_count),
        ]
        features.append(row_features)
        diagnostics.append(
            {
                "pattern_line_support": p_peak,
                "competing_line_support": o_peak,
                "pattern_line_bilateral": p.bilateral_balance,
                "competing_line_bilateral": o.bilateral_balance,
                "local_pattern_density_per_day": p.density_per_day,
                "local_nonpattern_density_per_day": o.density_per_day,
                "competing_line_blocks": float(o.line_count),
                "competing_line_spent_fraction": (o.line_spent_count / o.line_count) if o.line_count else float("nan"),
                "competing_line_slope_per_day": o.best_slope,
                "spend_log_bayes_factor": spend_bf,
            }
        )

        if counter % 5000 == 0:
            print(f"Computed trajectory features for {counter:,}/{query_indices.size:,} blocks", flush=True)

    return np.asarray(features, dtype=np.float64), diagnostics


def score_blocks(
    features: np.ndarray,
    labels: np.ndarray,
    sample_weights: np.ndarray,
    cfg: Config,
) -> Tuple[np.ndarray, Dict[str, float], Pipeline]:
    min_class = int(min(np.count_nonzero(labels == 0), np.count_nonzero(labels == 1)))
    folds = max(2, min(cfg.cv_folds, min_class))
    cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=cfg.random_seed)

    model = Pipeline(
        steps=[
            ("scale", StandardScaler()),
            (
                "logit",
                LogisticRegression(
                    C=0.7,
                    solver="lbfgs",
                    max_iter=2000,
                    random_state=cfg.random_seed,
                ),
            ),
        ]
    )

    # cross_val_predict does not route sample_weight through Pipeline consistently
    # across sklearn versions, so fit each fold explicitly.
    probabilities = np.empty(labels.size, dtype=np.float64)
    for train, test in cv.split(features, labels):
        fold_model = Pipeline(
            steps=[
                ("scale", StandardScaler()),
                (
                    "logit",
                    LogisticRegression(
                        C=0.7,
                            solver="lbfgs",
                        max_iter=2000,
                        random_state=cfg.random_seed,
                    ),
                ),
            ]
        )
        fold_model.fit(features[train], labels[train], logit__sample_weight=sample_weights[train])
        probabilities[test] = fold_model.predict_proba(features[test])[:, 1]

    model.fit(features, labels, logit__sample_weight=sample_weights)
    metrics = {
        "roc_auc": float(roc_auc_score(labels, probabilities, sample_weight=sample_weights)),
        "brier_score": float(brier_score_loss(labels, probabilities, sample_weight=sample_weights)),
        "positive_count": int(np.count_nonzero(labels == 1)),
        "negative_count_sampled": int(np.count_nonzero(labels == 0)),
    }
    return probabilities, metrics, model


def write_output(
    output_path: Path,
    fieldnames: Sequence[str],
    rows: List[Dict[str, str]],
    labels: np.ndarray,
    confidence_by_index: Dict[int, float],
    diagnostics_by_index: Dict[int, Dict[str, float]],
    cfg: Config,
) -> None:
    output_fields = list(fieldnames)
    if cfg.output_column not in output_fields:
        output_fields.append(cfg.output_column)

    diagnostic_fields = [
        "pattern_line_support",
        "competing_line_support",
        "pattern_line_bilateral",
        "competing_line_bilateral",
        "local_pattern_density_per_day",
        "local_nonpattern_density_per_day",
        "competing_line_blocks",
        "competing_line_spent_fraction",
        "competing_line_slope_per_day",
        "spend_log_bayes_factor",
    ]
    if cfg.write_diagnostics:
        for name in diagnostic_fields:
            if name not in output_fields:
                output_fields.append(name)

    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=output_fields, extrasaction="ignore")
        writer.writeheader()
        for idx, row in enumerate(rows):
            out = dict(row)
            if labels[idx] == 1:
                height = _parse_height(row)
                confidence = 1.0 if height in KNOWN_SATOSHI_CONFIDENCE_HEIGHTS else confidence_by_index[idx]
                out[cfg.output_column] = f"{confidence:.6f}"
                if cfg.write_diagnostics:
                    diag = diagnostics_by_index[idx]
                    for key in diagnostic_fields:
                        value = diag[key]
                        out[key] = "" if not np.isfinite(value) else f"{value:.6f}"
            else:
                out[cfg.output_column] = ""
                if cfg.write_diagnostics:
                    for key in diagnostic_fields:
                        out[key] = ""
            writer.writerow(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_csv", type=Path)
    parser.add_argument("output_csv", type=Path)
    parser.add_argument("--label-column", default="patoshi_updated")
    parser.add_argument("--output-column", default="patoshi_confidence")
    parser.add_argument("--window-days", type=float, default=12.0)
    parser.add_argument("--diagnostics", action="store_true", help="Append component columns as well as confidence.")
    parser.add_argument("--report-json", type=Path, default=None)
    args = parser.parse_args()

    cfg = Config(
        label_column=args.label_column,
        output_column=args.output_column,
        window_days=args.window_days,
        write_diagnostics=args.diagnostics,
    )

    fieldnames, rows, times, extranonces, spent, labels = read_csv(args.input_csv, cfg)
    if np.count_nonzero(labels == 1) < cfg.cv_folds:
        raise ValueError("Too few Patoshi-labelled rows to estimate confidence.")

    sampled_indices, sample_weights = stratified_negative_sample(labels, times, cfg)
    print(
        f"Scoring {np.count_nonzero(labels == 1):,} Patoshi-labelled blocks and "
        f"{np.count_nonzero(labels[sampled_indices] == 0):,} time-matched controls.",
        flush=True,
    )
    features, diagnostics = compute_features(sampled_indices, times, extranonces, spent, labels, cfg)
    sampled_labels = labels[sampled_indices]
    oof_probabilities, metrics, final_model = score_blocks(features, sampled_labels, sample_weights, cfg)

    confidence_by_index: Dict[int, float] = {}
    diagnostics_by_index: Dict[int, Dict[str, float]] = {}
    for local_pos, original_idx in enumerate(sampled_indices):
        if labels[original_idx] == 1:
            confidence_by_index[int(original_idx)] = float(np.clip(oof_probabilities[local_pos], 0.0, 1.0))
            diagnostics_by_index[int(original_idx)] = diagnostics[local_pos]

    write_output(
        args.output_csv,
        fieldnames,
        rows,
        labels,
        confidence_by_index,
        diagnostics_by_index,
        cfg,
    )

    positive_scores = np.asarray(list(confidence_by_index.values()), dtype=np.float64)
    metrics.update(
        {
            "input_csv": str(args.input_csv),
            "output_csv": str(args.output_csv),
            "label_column": cfg.label_column,
            "output_column": cfg.output_column,
            "patoshi_confidence_min": float(np.min(positive_scores)),
            "patoshi_confidence_p05": float(np.quantile(positive_scores, 0.05)),
            "patoshi_confidence_median": float(np.median(positive_scores)),
            "patoshi_confidence_p95": float(np.quantile(positive_scores, 0.95)),
            "patoshi_confidence_max": float(np.max(positive_scores)),
            "configuration": cfg.__dict__,
        }
    )

    report_path = args.report_json or args.output_csv.with_suffix(".report.json")
    with report_path.open("w", encoding="utf-8") as handle:
        json.dump(metrics, handle, indent=2, sort_keys=True)
    print(json.dumps(metrics, indent=2, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
