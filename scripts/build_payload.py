from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

STYLE_EXPOSURE_EPS = 1.0e-8
WEIGHT_TOL = 1.0e-6


def _month_key(value: Any) -> str:
    return pd.Timestamp(value).strftime("%Y-%m-%d")


def _single_row(df: pd.DataFrame, key: Any, key_name: str) -> pd.Series:
    row = df.loc[key]
    if isinstance(row, pd.DataFrame):
        if len(row) != 1:
            raise ValueError(f"{key_name} has {len(row)} rows for key={key}.")
        return row.iloc[0]
    return row


def _safe_float(value: Any, digits: int = 10) -> float | None:
    if value is None:
        return None
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(x):
        return None
    return round(x, digits)


def _style_label(name: str) -> str:
    prefix = "sty_orth_desc_"
    if name.startswith(prefix):
        return name[len(prefix) :]
    return name


def _load_inputs(root: Path) -> dict[str, pd.DataFrame]:
    output_dir = root / "data" / "tw_50_data" / "output"
    input_dir = root / "data" / "tw_50_data" / "input"
    required = {
        "portfolio_return": output_dir / "portfolio_return_decomp.parquet",
        "benchmark_return": output_dir / "benchmark_return_decomp.parquet",
        "active_return": output_dir / "active_return_decomp.parquet",
        "portfolio_risk": output_dir / "portfolio_risk_decomp.parquet",
        "benchmark_risk": output_dir / "benchmark_risk_decomp.parquet",
        "active_risk": output_dir / "active_risk_decomp.parquet",
        "asset_return": output_dir / "asset_return_decomp.parquet",
        "asset_risk": output_dir / "asset_risk_decomp.parquet",
        "factor_returns": output_dir / "factor_returns.parquet",
        "multi_industry": input_dir / "multi_industry.parquet",
    }
    missing = [str(path) for path in required.values() if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Missing required data files: {missing}")

    tables: dict[str, pd.DataFrame] = {}
    for key, path in required.items():
        df = pd.read_parquet(path)
        tables[key] = df

    for key in [
        "portfolio_return",
        "benchmark_return",
        "active_return",
        "portfolio_risk",
        "benchmark_risk",
        "active_risk",
        "asset_return",
        "asset_risk",
        "multi_industry",
    ]:
        tables[key]["date"] = pd.to_datetime(tables[key]["date"], errors="raise")

    tables["factor_returns"].index = pd.to_datetime(
        tables["factor_returns"].index, errors="raise"
    )
    return tables


def _build_payload(root: Path) -> dict[str, Any]:
    tables = _load_inputs(root)
    portfolio_return = tables["portfolio_return"].sort_values("date").reset_index(drop=True)
    benchmark_return = tables["benchmark_return"].sort_values("date").reset_index(drop=True)
    active_return = tables["active_return"].sort_values("date").reset_index(drop=True)
    portfolio_risk = tables["portfolio_risk"].sort_values("date").reset_index(drop=True)
    benchmark_risk = tables["benchmark_risk"].sort_values("date").reset_index(drop=True)
    active_risk = tables["active_risk"].sort_values("date").reset_index(drop=True)
    asset_return = tables["asset_return"].sort_values(["date", "asset_id"]).reset_index(drop=True)
    asset_risk = tables["asset_risk"].sort_values(["date", "asset_id"]).reset_index(drop=True)
    factor_returns = tables["factor_returns"].sort_index()
    multi_industry = tables["multi_industry"].copy()

    contrib_cols = [c for c in portfolio_return.columns if c.startswith("contrib_")]
    industry_factors = [
        c[len("contrib_") :] for c in contrib_cols if not c.startswith("contrib_sty_")
    ]
    style_factors = [c[len("contrib_") :] for c in contrib_cols if c.startswith("contrib_sty_")]
    all_factors = [*industry_factors, *style_factors]
    if not industry_factors or not style_factors:
        raise ValueError("Failed to identify industry/style factors from portfolio data.")

    risk_cols = set(portfolio_risk.columns)
    missing_risk_cols = [f"factor_risk_{f}" for f in all_factors if f"factor_risk_{f}" not in risk_cols]
    if missing_risk_cols:
        raise ValueError(f"Missing risk decomposition columns: {missing_risk_cols}")

    unique_dates = sorted(pd.to_datetime(portfolio_return["date"]).unique())
    date_keys = [_month_key(d) for d in unique_dates]
    if len(unique_dates) == 0:
        raise ValueError("No dates found in portfolio_return_decomp.")

    portfolio_return_idx = portfolio_return.set_index("date")
    benchmark_return_idx = benchmark_return.set_index("date")
    active_return_idx = active_return.set_index("date")
    portfolio_risk_idx = portfolio_risk.set_index("date")
    benchmark_risk_idx = benchmark_risk.set_index("date")
    active_risk_idx = active_risk.set_index("date")

    weights_by_date = (
        asset_return.groupby("date", as_index=True)[["w_port", "w_bench"]].sum().sort_index()
    )
    bad_weight_dates = []
    for date, row in weights_by_date.iterrows():
        if abs(float(row["w_port"]) - 1.0) > WEIGHT_TOL or abs(float(row["w_bench"]) - 1.0) > WEIGHT_TOL:
            bad_weight_dates.append(_month_key(date))
    if bad_weight_dates:
        raise ValueError(f"Weight sums are not close to 1.0 for dates: {bad_weight_dates}")

    multi_industry["date"] = multi_industry["date"].dt.to_period("M").dt.to_timestamp()
    industry_monthly = (
        multi_industry.groupby(["date", "asset_id", "industry_id"], as_index=False)["industry_weight"].mean()
    )
    month_asset_weights = (
        asset_return[["date", "asset_id", "w_port", "w_bench"]]
        .groupby(["date", "asset_id"], as_index=False)
        .mean()
    )
    industry_with_weights = industry_monthly.merge(
        month_asset_weights, on=["date", "asset_id"], how="left"
    )
    industry_with_weights[["w_port", "w_bench"]] = industry_with_weights[["w_port", "w_bench"]].fillna(0.0)
    industry_with_weights["weight_port_factor"] = (
        industry_with_weights["industry_weight"] * industry_with_weights["w_port"]
    )
    industry_with_weights["weight_bench_factor"] = (
        industry_with_weights["industry_weight"] * industry_with_weights["w_bench"]
    )

    industry_factor_weights = (
        industry_with_weights.groupby(["date", "industry_id"], as_index=False)[
            ["weight_port_factor", "weight_bench_factor"]
        ].sum()
    )

    industry_asset_exposure: dict[str, dict[str, dict[str, float]]] = {}
    for row in industry_monthly.itertuples(index=False):
        date_key = _month_key(row.date)
        asset = str(row.asset_id)
        factor = str(row.industry_id)
        industry_asset_exposure.setdefault(date_key, {}).setdefault(asset, {})[factor] = (
            _safe_float(row.industry_weight) or 0.0
        )

    industry_weight_lookup: dict[str, dict[str, dict[str, float]]] = {}
    for row in industry_factor_weights.itertuples(index=False):
        date_key = _month_key(row.date)
        factor = str(row.industry_id)
        industry_weight_lookup.setdefault(date_key, {})[factor] = {
            "portfolio": _safe_float(row.weight_port_factor) or 0.0,
            "benchmark": _safe_float(row.weight_bench_factor) or 0.0,
        }

    port_monthly = portfolio_return.set_index("date")["ret_port"].reindex(unique_dates)
    bench_monthly = benchmark_return.set_index("date")["ret_bench"].reindex(unique_dates)
    cum_port = (1.0 + port_monthly).cumprod() - 1.0
    cum_bench = (1.0 + bench_monthly).cumprod() - 1.0
    cum_active = ((1.0 + port_monthly).cumprod() / (1.0 + bench_monthly).cumprod()) - 1.0

    payload: dict[str, Any] = {
        "meta": {
            "generatedAt": pd.Timestamp.utcnow().isoformat(),
            "dates": date_keys,
            "industryFactors": industry_factors,
            "styleFactors": style_factors,
            "factorLabels": {
                **{f: f for f in industry_factors},
                **{f: _style_label(f) for f in style_factors},
            },
            "assets": sorted(asset_return["asset_id"].dropna().astype(str).unique().tolist()),
        },
        "portfolio": {
            "metricsByMonth": {},
            "series": [],
            "groupByMonth": {},
            "industryFactorsByMonth": {},
            "styleFactorsByMonth": {},
        },
        "stocks": {"byMonth": {}},
        "factorStats": {
            "factors": all_factors,
            "returnsByMonth": {},
        },
    }

    non_finite_style_exposure_count = 0

    for date in unique_dates:
        date_key = _month_key(date)
        port_ret_row = _single_row(portfolio_return_idx, date, "portfolio_return")
        bench_ret_row = _single_row(benchmark_return_idx, date, "benchmark_return")
        active_ret_row = _single_row(active_return_idx, date, "active_return")
        port_risk_row = _single_row(portfolio_risk_idx, date, "portfolio_risk")
        bench_risk_row = _single_row(benchmark_risk_idx, date, "benchmark_risk")
        active_risk_row = _single_row(active_risk_idx, date, "active_risk")
        factor_ret_row = _single_row(factor_returns, date, "factor_returns")

        month_asset_ret = asset_return[asset_return["date"] == date].copy()
        month_asset_risk = asset_risk[asset_risk["date"] == date].copy()
        month_asset_ret = month_asset_ret.groupby("asset_id", as_index=False).mean(numeric_only=True)
        month_asset_risk = month_asset_risk.groupby("asset_id", as_index=False).mean(numeric_only=True)
        month_asset = month_asset_ret.merge(
            month_asset_risk,
            on="asset_id",
            how="inner",
            suffixes=("_ret", "_risk"),
        )

        style_weight_port: dict[str, float] = {f: 0.0 for f in style_factors}
        style_weight_bench: dict[str, float] = {f: 0.0 for f in style_factors}

        stock_records: dict[str, Any] = {}
        month_assets = month_asset.sort_values("w_port_ret", ascending=False)["asset_id"].astype(str).tolist()

        for row in month_asset.itertuples(index=False):
            asset_id = str(row.asset_id)
            w_port = float(row.w_port_ret)
            w_bench = float(row.w_bench_ret)

            industry_exp_map = industry_asset_exposure.get(date_key, {}).get(asset_id, {})
            industry_items = []
            style_items = []

            for factor in industry_factors:
                exposure = float(industry_exp_map.get(factor, 0.0))
                factor_ret = float(factor_ret_row.get(factor, 0.0))
                ret_contrib = float(getattr(row, f"contrib_{factor}"))
                var_contrib = float(getattr(row, f"factor_risk_{factor}"))
                industry_items.append(
                    {
                        "factor": factor,
                        "factorReturn": _safe_float(factor_ret),
                        "exposure": _safe_float(exposure),
                        "returnContribution": _safe_float(ret_contrib),
                        "varianceContribution": _safe_float(var_contrib),
                        "weightPort": _safe_float(w_port),
                        "weightBench": _safe_float(w_bench),
                        "weightPortFactor": _safe_float(w_port * exposure),
                        "weightBenchFactor": _safe_float(w_bench * exposure),
                    }
                )

            for factor in style_factors:
                factor_ret = float(factor_ret_row.get(factor, 0.0))
                ret_contrib = float(getattr(row, f"contrib_{factor}"))
                if abs(factor_ret) <= STYLE_EXPOSURE_EPS:
                    exposure = 0.0
                else:
                    exposure = ret_contrib / factor_ret
                if not np.isfinite(exposure):
                    non_finite_style_exposure_count += 1
                    exposure = 0.0
                var_contrib = float(getattr(row, f"factor_risk_{factor}"))
                style_weight_port[factor] += w_port * exposure
                style_weight_bench[factor] += w_bench * exposure
                style_items.append(
                    {
                        "factor": factor,
                        "factorReturn": _safe_float(factor_ret),
                        "exposure": _safe_float(exposure),
                        "returnContribution": _safe_float(ret_contrib),
                        "varianceContribution": _safe_float(var_contrib),
                        "weightPort": _safe_float(w_port),
                        "weightBench": _safe_float(w_bench),
                        "weightPortFactor": _safe_float(w_port * exposure),
                        "weightBenchFactor": _safe_float(w_bench * exposure),
                    }
                )

            industry_return = sum(float(getattr(row, f"contrib_{f}")) for f in industry_factors)
            style_return = sum(float(getattr(row, f"contrib_{f}")) for f in style_factors)
            industry_variance = sum(float(getattr(row, f"factor_risk_{f}")) for f in industry_factors)
            style_variance = sum(float(getattr(row, f"factor_risk_{f}")) for f in style_factors)

            stock_records[asset_id] = {
                "assetId": asset_id,
                "return": _safe_float(row.ret),
                "variance": _safe_float(row.lhs_var),
                "weightPort": _safe_float(w_port),
                "weightBench": _safe_float(w_bench),
                "groupReturn": {
                    "industry": _safe_float(industry_return),
                    "style": _safe_float(style_return),
                    "residual": _safe_float(row.residual),
                },
                "groupVariance": {
                    "industry": _safe_float(industry_variance),
                    "style": _safe_float(style_variance),
                    "residual": _safe_float(row.residual_risk_total),
                },
                "industryFactors": industry_items,
                "styleFactors": style_items,
            }

        payload["stocks"]["byMonth"][date_key] = {
            "assets": month_assets,
            "records": stock_records,
        }

        ret_port = float(port_ret_row["ret_port"])
        ret_bench = float(bench_ret_row["ret_bench"])
        ret_active = float(active_ret_row["ret_active"])
        var_port = float(port_risk_row["lhs_var"])
        var_bench = float(bench_risk_row["lhs_var"])
        tracking_error = float(active_risk_row["tracking_error_model"])
        sharpe_port = ret_port / math.sqrt(var_port) if var_port > 0.0 else None
        sharpe_bench = ret_bench / math.sqrt(var_bench) if var_bench > 0.0 else None
        information = ret_active / tracking_error if abs(tracking_error) > 0.0 else None

        payload["portfolio"]["metricsByMonth"][date_key] = {
            "returnPort": _safe_float(ret_port),
            "returnBench": _safe_float(ret_bench),
            "returnActive": _safe_float(ret_active),
            "variancePort": _safe_float(var_port),
            "varianceBench": _safe_float(var_bench),
            "sharpePort": _safe_float(sharpe_port),
            "sharpeBench": _safe_float(sharpe_bench),
            "information": _safe_float(information),
            "trackingError": _safe_float(tracking_error),
        }

        payload["portfolio"]["series"].append(
            {
                "date": date_key,
                "returnPort": _safe_float(ret_port),
                "returnBench": _safe_float(ret_bench),
                "returnActive": _safe_float(ret_active),
                "cumPort": _safe_float(cum_port.loc[date]),
                "cumBench": _safe_float(cum_bench.loc[date]),
                "cumActive": _safe_float(cum_active.loc[date]),
                "variancePort": _safe_float(var_port),
                "varianceBench": _safe_float(var_bench),
                "trackingError": _safe_float(tracking_error),
                "sharpePort": _safe_float(sharpe_port),
                "sharpeBench": _safe_float(sharpe_bench),
                "information": _safe_float(information),
            }
        )

        industry_port_return = sum(float(port_ret_row[f"contrib_{f}"]) for f in industry_factors)
        style_port_return = sum(float(port_ret_row[f"contrib_{f}"]) for f in style_factors)
        industry_bench_return = sum(float(bench_ret_row[f"contrib_{f}"]) for f in industry_factors)
        style_bench_return = sum(float(bench_ret_row[f"contrib_{f}"]) for f in style_factors)
        industry_port_var = sum(float(port_risk_row[f"factor_risk_{f}"]) for f in industry_factors)
        style_port_var = sum(float(port_risk_row[f"factor_risk_{f}"]) for f in style_factors)
        industry_bench_var = sum(float(bench_risk_row[f"factor_risk_{f}"]) for f in industry_factors)
        style_bench_var = sum(float(bench_risk_row[f"factor_risk_{f}"]) for f in style_factors)

        industry_weight_port_total = 0.0
        industry_weight_bench_total = 0.0
        month_industry_weights = industry_weight_lookup.get(date_key, {})
        for factor in industry_factors:
            values = month_industry_weights.get(factor, {"portfolio": 0.0, "benchmark": 0.0})
            industry_weight_port_total += abs(float(values["portfolio"]))
            industry_weight_bench_total += abs(float(values["benchmark"]))

        style_weight_port_total = sum(abs(float(v)) for v in style_weight_port.values())
        style_weight_bench_total = sum(abs(float(v)) for v in style_weight_bench.values())
        invest_weights = weights_by_date.loc[date]

        payload["portfolio"]["groupByMonth"][date_key] = {
            "return": {
                "industry": {
                    "portfolio": _safe_float(industry_port_return),
                    "benchmark": _safe_float(industry_bench_return),
                },
                "style": {
                    "portfolio": _safe_float(style_port_return),
                    "benchmark": _safe_float(style_bench_return),
                },
                "residual": {
                    "portfolio": _safe_float(port_ret_row["residual_port"]),
                    "benchmark": _safe_float(bench_ret_row["residual_bench"]),
                },
            },
            "variance": {
                "industry": {
                    "portfolio": _safe_float(industry_port_var),
                    "benchmark": _safe_float(industry_bench_var),
                },
                "style": {
                    "portfolio": _safe_float(style_port_var),
                    "benchmark": _safe_float(style_bench_var),
                },
                "residual": {
                    "portfolio": _safe_float(port_risk_row["residual_risk_total"]),
                    "benchmark": _safe_float(bench_risk_row["residual_risk_total"]),
                },
            },
            "weight": {
                "industry": {
                    "portfolio": _safe_float(industry_weight_port_total),
                    "benchmark": _safe_float(industry_weight_bench_total),
                },
                "style": {
                    "portfolio": _safe_float(style_weight_port_total),
                    "benchmark": _safe_float(style_weight_bench_total),
                },
                "residual": {"portfolio": 0.0, "benchmark": 0.0},
            },
            "investedWeight": {
                "portfolio": _safe_float(invest_weights["w_port"]),
                "benchmark": _safe_float(invest_weights["w_bench"]),
            },
        }

        industry_rows = []
        for factor in industry_factors:
            factor_key = f"contrib_{factor}"
            risk_key = f"factor_risk_{factor}"
            iw = month_industry_weights.get(factor, {"portfolio": 0.0, "benchmark": 0.0})
            industry_rows.append(
                {
                    "factor": factor,
                    "portfolio": {
                        "return": _safe_float(port_ret_row[factor_key]),
                        "variance": _safe_float(port_risk_row[risk_key]),
                        "weight": _safe_float(iw["portfolio"]),
                    },
                    "benchmark": {
                        "return": _safe_float(bench_ret_row[factor_key]),
                        "variance": _safe_float(bench_risk_row[risk_key]),
                        "weight": _safe_float(iw["benchmark"]),
                    },
                }
            )
        payload["portfolio"]["industryFactorsByMonth"][date_key] = industry_rows

        style_rows = []
        for factor in style_factors:
            factor_key = f"contrib_{factor}"
            risk_key = f"factor_risk_{factor}"
            style_rows.append(
                {
                    "factor": factor,
                    "portfolio": {
                        "return": _safe_float(port_ret_row[factor_key]),
                        "variance": _safe_float(port_risk_row[risk_key]),
                        "weight": _safe_float(style_weight_port[factor]),
                    },
                    "benchmark": {
                        "return": _safe_float(bench_ret_row[factor_key]),
                        "variance": _safe_float(bench_risk_row[risk_key]),
                        "weight": _safe_float(style_weight_bench[factor]),
                    },
                }
            )
        payload["portfolio"]["styleFactorsByMonth"][date_key] = style_rows

        payload["factorStats"]["returnsByMonth"][date_key] = {
            factor: _safe_float(factor_ret_row[factor]) for factor in all_factors
        }

    if non_finite_style_exposure_count > 0:
        raise ValueError(
            f"Found non-finite style exposures during payload build: {non_finite_style_exposure_count}"
        )
    return payload


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    payload = _build_payload(root)
    output_path = root / "frontend" / "data" / "payload.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Payload written: {output_path}")
    print(f"Dates: {len(payload['meta']['dates'])}")
    print(f"Assets: {len(payload['meta']['assets'])}")
    print(f"Industry factors: {len(payload['meta']['industryFactors'])}")
    print(f"Style factors: {len(payload['meta']['styleFactors'])}")


if __name__ == "__main__":
    main()
