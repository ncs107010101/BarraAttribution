from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

MAX_SELECTABLE_FUNDS = 5
FACTOR_WEIGHT_EPS = 1.0e-10
DESC_DISPLAY_ALIASES = {
    "desc_beta": "desc_volatility_2",
}


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


def _month_key(value: Any) -> str:
    return pd.Timestamp(value).strftime("%Y-%m")


def _factor_label(name: str) -> str:
    if name.startswith("sty_orth_"):
        return name.replace("sty_orth_", "style_")
    return name


def _display_desc_name(name: str) -> str:
    return DESC_DISPLAY_ALIASES.get(name, name)


def _weighted_exposure(contrib: float, factor_ret: float) -> float:
    if abs(factor_ret) <= FACTOR_WEIGHT_EPS:
        return 0.0
    return contrib / factor_ret


def _load_inputs(root: Path) -> dict[str, Any]:
    output_dir = root / "data" / "tw_multiFund" / "output_full"
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
        "run_metadata": output_dir / "run_metadata.json",
    }
    missing = [str(p) for p in required.values() if not p.exists()]
    if missing:
        raise FileNotFoundError(f"Missing required files: {missing}")

    tables: dict[str, Any] = {
        "portfolio_return": pd.read_parquet(required["portfolio_return"]),
        "benchmark_return": pd.read_parquet(required["benchmark_return"]),
        "active_return": pd.read_parquet(required["active_return"]),
        "portfolio_risk": pd.read_parquet(required["portfolio_risk"]),
        "benchmark_risk": pd.read_parquet(required["benchmark_risk"]),
        "active_risk": pd.read_parquet(required["active_risk"]),
        "asset_return": pd.read_parquet(required["asset_return"]),
        "asset_risk": pd.read_parquet(required["asset_risk"]),
        "factor_returns": pd.read_parquet(required["factor_returns"]),
        "run_metadata": json.loads(required["run_metadata"].read_text(encoding="utf-8")),
    }

    for key in [
        "portfolio_return",
        "benchmark_return",
        "active_return",
        "portfolio_risk",
        "benchmark_risk",
        "active_risk",
        "asset_return",
        "asset_risk",
        "factor_returns",
    ]:
        tables[key]["date"] = pd.to_datetime(tables[key]["date"], errors="raise")

    return tables


def _factor_groups(portfolio_return: pd.DataFrame, portfolio_risk: pd.DataFrame) -> tuple[list[str], list[str]]:
    contrib_cols = [c for c in portfolio_return.columns if c.startswith("contrib_")]
    style_factors = [c[len("contrib_") :] for c in contrib_cols if c.startswith("contrib_sty_")]
    industry_factors = [c[len("contrib_") :] for c in contrib_cols if not c.startswith("contrib_sty_")]

    risk_cols = set(portfolio_risk.columns)
    missing_risk = [
        f"factor_risk_{f}" for f in [*industry_factors, *style_factors] if f"factor_risk_{f}" not in risk_cols
    ]
    if missing_risk:
        raise ValueError(f"Missing factor risk columns: {missing_risk[:10]}")

    return industry_factors, style_factors


def _build_payload(root: Path) -> dict[str, Any]:
    t = _load_inputs(root)
    portfolio_return = t["portfolio_return"].sort_values(["fund_code", "date"]).reset_index(drop=True)
    benchmark_return = t["benchmark_return"].sort_values(["fund_code", "date"]).reset_index(drop=True)
    active_return = t["active_return"].sort_values(["fund_code", "date"]).reset_index(drop=True)
    portfolio_risk = t["portfolio_risk"].sort_values(["fund_code", "date"]).reset_index(drop=True)
    benchmark_risk = t["benchmark_risk"].sort_values(["fund_code", "date"]).reset_index(drop=True)
    active_risk = t["active_risk"].sort_values(["fund_code", "date"]).reset_index(drop=True)
    asset_return = t["asset_return"].sort_values(["fund_code", "date", "asset_id"]).reset_index(drop=True)
    asset_risk = t["asset_risk"].sort_values(["fund_code", "date", "asset_id"]).reset_index(drop=True)
    factor_returns = t["factor_returns"].sort_values(["fund_code", "date"]).reset_index(drop=True)
    run_meta: dict[str, Any] = t["run_metadata"]

    industry_factors, style_factors = _factor_groups(portfolio_return, portfolio_risk)
    all_factors = [*industry_factors, *style_factors]
    industry_contrib_cols = [f"contrib_{f}" for f in industry_factors]
    style_contrib_cols = [f"contrib_{f}" for f in style_factors]
    industry_risk_cols = [f"factor_risk_{f}" for f in industry_factors]
    style_risk_cols = [f"factor_risk_{f}" for f in style_factors]

    merged = (
        portfolio_return[
            [
                "fund_code",
                "fund_name",
                "date",
                "return_ym",
                "holding_ym",
                "ret_port",
                "residual_port",
                *industry_contrib_cols,
                *style_contrib_cols,
            ]
        ]
        .merge(
            benchmark_return[
                [
                    "fund_code",
                    "date",
                    "ret_bench",
                    "residual_bench",
                    *industry_contrib_cols,
                    *style_contrib_cols,
                ]
            ],
            on=["fund_code", "date"],
            how="inner",
            suffixes=("", "_bench"),
        )
        .merge(
            active_return[["fund_code", "date", "ret_active"]],
            on=["fund_code", "date"],
            how="inner",
        )
        .merge(
            portfolio_risk[
                [
                    "fund_code",
                    "date",
                    "lhs_var",
                    "residual_risk_total",
                    *industry_risk_cols,
                    *style_risk_cols,
                ]
            ].rename(
                columns={
                    "lhs_var": "variance_port",
                    "residual_risk_total": "residual_variance_port",
                }
            ),
            on=["fund_code", "date"],
            how="inner",
        )
        .merge(
            benchmark_risk[
                [
                    "fund_code",
                    "date",
                    "lhs_var",
                    "residual_risk_total",
                    *industry_risk_cols,
                    *style_risk_cols,
                ]
            ].rename(
                columns={
                    "lhs_var": "variance_bench",
                    "residual_risk_total": "residual_variance_bench",
                    **{f"{c}": f"{c}_bench" for c in [*industry_risk_cols, *style_risk_cols]},
                }
            ),
            on=["fund_code", "date"],
            how="inner",
        )
        .merge(
            active_risk[["fund_code", "date", "tracking_error_model", "tracking_error_var_model"]],
            on=["fund_code", "date"],
            how="inner",
        )
        .sort_values(["fund_code", "date"])
        .reset_index(drop=True)
    )

    merged["industry_return"] = merged[industry_contrib_cols].sum(axis=1)
    merged["style_return"] = merged[style_contrib_cols].sum(axis=1)
    merged["residual_return"] = merged["residual_port"]
    merged["industry_variance"] = merged[industry_risk_cols].sum(axis=1)
    merged["style_variance"] = merged[style_risk_cols].sum(axis=1)
    merged["residual_variance"] = merged["residual_variance_port"]

    funds_meta = (
        merged[["fund_code", "fund_name"]]
        .drop_duplicates()
        .sort_values("fund_code")
        .to_dict(orient="records")
    )
    dates = sorted(merged["date"].unique().tolist())
    date_keys = [_month_key(d) for d in dates]

    benchmark_label = (
        "台股全市場動態市值基準（上市+上櫃；每月以 exp(desc_size) 正規化，"
        "並與基金持股做次月報酬對齊）"
    )

    desc_cols_meta = [
        str(c)
        for c in run_meta.get("preprocess", {}).get("desc_columns", [])
        if isinstance(c, str) and c.startswith("desc_")
    ]
    style_desc_candidates = [_display_desc_name(c) for c in desc_cols_meta if c != "desc_is_otc"]
    style_label_map: dict[str, str] = {}
    for sf in style_factors:
        if sf.startswith("sty_orth_desc_"):
            style_label_map[sf] = _display_desc_name(sf.replace("sty_orth_", ""))
            continue
        if sf.startswith("sty_orth_"):
            tail = sf.replace("sty_orth_", "")
            if tail.isdigit():
                idx = int(tail) - 1
                if 0 <= idx < len(style_desc_candidates):
                    style_label_map[sf] = _display_desc_name(style_desc_candidates[idx])
                    continue
        style_label_map[sf] = _factor_label(sf)

    factor_label_map = {f: _factor_label(f) for f in industry_factors}
    factor_label_map.update(style_label_map)

    payload: dict[str, Any] = {
        "meta": {
            "generatedAt": pd.Timestamp.utcnow().isoformat(),
            "maxSelectableFunds": MAX_SELECTABLE_FUNDS,
            "dates": date_keys,
            "funds": funds_meta,
            "industryFactors": industry_factors,
            "styleFactors": style_factors,
            "factorLabels": factor_label_map,
            "styleDescriptorCandidates": style_desc_candidates,
            "benchmarkDefinition": benchmark_label,
            "source": {
                "outputDir": str(root / "data" / "tw_multiFund" / "output_full"),
                "alignment": run_meta.get("alignment", {}),
            },
        },
        "funds": {},
        "factorReturnsByMonth": {},
    }

    factor_returns_by_month: dict[str, dict[str, float | None]] = {}
    fr_monthly_mean = (
        factor_returns.groupby("date", as_index=True)[all_factors]
        .mean(numeric_only=True)
        .sort_index()
    )
    for d, rec in fr_monthly_mean.iterrows():
        month_key = _month_key(d)
        factor_returns_by_month[month_key] = {f: _safe_float(rec[f]) for f in all_factors}
    payload["factorReturnsByMonth"] = factor_returns_by_month

    factor_return_idx = factor_returns.set_index(["fund_code", "date"])
    portfolio_return_idx = portfolio_return.set_index(["fund_code", "date"])
    benchmark_return_idx = benchmark_return.set_index(["fund_code", "date"])
    portfolio_risk_idx = portfolio_risk.set_index(["fund_code", "date"])
    benchmark_risk_idx = benchmark_risk.set_index(["fund_code", "date"])

    for fund in funds_meta:
        code = str(fund["fund_code"])
        name = str(fund["fund_name"])
        g = merged[merged["fund_code"] == code].sort_values("date").copy()
        if g.empty:
            continue

        port_vals = g["ret_port"].to_numpy(dtype=float)
        bench_vals = g["ret_bench"].to_numpy(dtype=float)
        cum_port = np.cumprod(1.0 + port_vals) - 1.0
        cum_bench = np.cumprod(1.0 + bench_vals) - 1.0
        cum_active = (np.cumprod(1.0 + port_vals) / np.cumprod(1.0 + bench_vals)) - 1.0

        series_rows: list[dict[str, Any]] = []
        for i, row in enumerate(g.itertuples(index=False)):
            variance_port = float(row.variance_port)
            variance_bench = float(row.variance_bench)
            tracking_error = float(row.tracking_error_model)
            ret_port = float(row.ret_port)
            ret_bench = float(row.ret_bench)
            ret_active = float(row.ret_active)
            sharpe_port = ret_port / np.sqrt(variance_port) if variance_port > 0 else None
            sharpe_bench = ret_bench / np.sqrt(variance_bench) if variance_bench > 0 else None
            information = ret_active / tracking_error if abs(tracking_error) > 0 else None

            series_rows.append(
                {
                    "date": _month_key(row.date),
                    "returnYm": str(row.return_ym),
                    "holdingYm": str(row.holding_ym),
                    "returnPort": _safe_float(ret_port),
                    "returnBench": _safe_float(ret_bench),
                    "returnActive": _safe_float(ret_active),
                    "cumPort": _safe_float(cum_port[i]),
                    "cumBench": _safe_float(cum_bench[i]),
                    "cumActive": _safe_float(cum_active[i]),
                    "variancePort": _safe_float(variance_port),
                    "varianceBench": _safe_float(variance_bench),
                    "trackingError": _safe_float(tracking_error),
                    "trackingErrorVar": _safe_float(row.tracking_error_var_model),
                    "sharpePort": _safe_float(sharpe_port),
                    "sharpeBench": _safe_float(sharpe_bench),
                    "information": _safe_float(information),
                    "groupReturn": {
                        "industry": _safe_float(row.industry_return),
                        "style": _safe_float(row.style_return),
                        "residual": _safe_float(row.residual_return),
                    },
                    "groupVariance": {
                        "industry": _safe_float(row.industry_variance),
                        "style": _safe_float(row.style_variance),
                        "residual": _safe_float(row.residual_variance),
                    },
                }
            )

        factor_by_month: dict[str, Any] = {}
        for d in g["date"].tolist():
            month_key = _month_key(d)
            fr_row = factor_return_idx.loc[(code, d)]
            pr_row = portfolio_return_idx.loc[(code, d)]
            br_row = benchmark_return_idx.loc[(code, d)]
            pk_row = portfolio_risk_idx.loc[(code, d)]
            bk_row = benchmark_risk_idx.loc[(code, d)]

            def _pack(factors: list[str]) -> dict[str, list[float | None]]:
                port_ret = []
                bench_ret = []
                port_var = []
                bench_var = []
                port_w = []
                bench_w = []
                for f in factors:
                    ckey = f"contrib_{f}"
                    rkey = f"factor_risk_{f}"
                    p_ret = float(pr_row[ckey])
                    b_ret = float(br_row[ckey])
                    p_var = float(pk_row[rkey])
                    b_var = float(bk_row[rkey])
                    f_ret = float(fr_row[f])
                    p_w = _weighted_exposure(p_ret, f_ret)
                    b_w = _weighted_exposure(b_ret, f_ret)

                    port_ret.append(_safe_float(p_ret))
                    bench_ret.append(_safe_float(b_ret))
                    port_var.append(_safe_float(p_var))
                    bench_var.append(_safe_float(b_var))
                    port_w.append(_safe_float(p_w))
                    bench_w.append(_safe_float(b_w))

                return {
                    "pr": port_ret,
                    "br": bench_ret,
                    "pv": port_var,
                    "bv": bench_var,
                    "pw": port_w,
                    "bw": bench_w,
                }

            factor_by_month[month_key] = {
                "industry": _pack(industry_factors),
                "style": _pack(style_factors),
            }

        payload["funds"][code] = {
            "fundCode": code,
            "fundName": name,
            "series": series_rows,
            "factorByMonth": factor_by_month,
            "stocksByMonth": {},
        }

    risk_cols_for_join = [
        "fund_code",
        "fund_name",
        "date",
        "asset_id",
        "w_port",
        "w_bench",
        "lhs_var",
        "residual_risk_total",
        "return_ym",
        "holding_ym",
        *industry_risk_cols,
        *style_risk_cols,
    ]
    ret_cols_for_join = [
        "fund_code",
        "fund_name",
        "date",
        "asset_id",
        "ret",
        "residual",
        "return_ym",
        "holding_ym",
        *industry_contrib_cols,
        *style_contrib_cols,
    ]

    asset_join = asset_return[ret_cols_for_join].merge(
        asset_risk[risk_cols_for_join],
        on=["fund_code", "fund_name", "date", "asset_id", "return_ym", "holding_ym"],
        how="inner",
        suffixes=("", "_risk"),
    )
    asset_join = asset_join[asset_join["w_port"] > 0].copy()
    asset_join.sort_values(["fund_code", "date", "w_port"], ascending=[True, True, False], inplace=True)

    for (code, d), month_df in asset_join.groupby(["fund_code", "date"], sort=True):
        if code not in payload["funds"]:
            continue

        month_key = _month_key(d)
        fr_row = factor_return_idx.loc[(code, d)]
        records: dict[str, Any] = {}
        assets_sorted: list[str] = []

        for rec in month_df.to_dict(orient="records"):
            asset_id = str(rec["asset_id"])
            assets_sorted.append(asset_id)

            industry_contrib_vals = [float(rec[c]) for c in industry_contrib_cols]
            industry_risk_vals = [float(rec[c]) for c in industry_risk_cols]
            style_contrib_vals = [float(rec[c]) for c in style_contrib_cols]
            style_risk_vals = [float(rec[c]) for c in style_risk_cols]

            if industry_contrib_vals:
                ind_idx = int(np.argmax(np.abs(industry_contrib_vals)))
                ind_factor = industry_factors[ind_idx]
                ind_ret = industry_contrib_vals[ind_idx]
                ind_var = industry_risk_vals[ind_idx]
            else:
                ind_factor = ""
                ind_ret = 0.0
                ind_var = 0.0

            ind_factor_ret = float(fr_row[ind_factor]) if ind_factor else 0.0
            ind_wexp = _weighted_exposure(ind_ret, ind_factor_ret)

            style_rows: list[list[float | None]] = []
            for idx, factor in enumerate(style_factors):
                f_ret = float(fr_row[factor])
                s_ret = style_contrib_vals[idx]
                s_var = style_risk_vals[idx]
                s_wexp = _weighted_exposure(s_ret, f_ret)
                style_rows.append(
                    [
                        _safe_float(s_ret),
                        _safe_float(s_var),
                        _safe_float(f_ret),
                        _safe_float(s_wexp),
                    ]
                )

            group_ret = [
                _safe_float(sum(industry_contrib_vals)),
                _safe_float(sum(style_contrib_vals)),
                _safe_float(float(rec["residual"])),
            ]
            group_var = [
                _safe_float(sum(industry_risk_vals)),
                _safe_float(sum(style_risk_vals)),
                _safe_float(float(rec["residual_risk_total"])),
            ]

            records[asset_id] = {
                "assetId": asset_id,
                "returnYm": str(rec["return_ym"]),
                "holdingYm": str(rec["holding_ym"]),
                "ret": _safe_float(rec["ret"]),
                "var": _safe_float(rec["lhs_var"]),
                "wPort": _safe_float(rec["w_port"]),
                "wBench": _safe_float(rec["w_bench"]),
                "activeWeight": _safe_float(float(rec["w_port"]) - float(rec["w_bench"])),
                "groupRet": group_ret,
                "groupVar": group_var,
                "industry": {
                    "factor": ind_factor,
                    "r": _safe_float(ind_ret),
                    "v": _safe_float(ind_var),
                    "fr": _safe_float(ind_factor_ret),
                    "x": _safe_float(ind_wexp),
                },
                "style": style_rows,
            }

        payload["funds"][code]["stocksByMonth"][month_key] = {
            "assets": assets_sorted,
            "records": records,
        }

    return payload


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    payload = _build_payload(root)
    output_path = root / "frontend" / "data" / "payload.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Payload written: {output_path}")
    print(f"Funds: {len(payload['meta']['funds'])}")
    print(f"Dates: {len(payload['meta']['dates'])}")
    print(f"Industry factors: {len(payload['meta']['industryFactors'])}")
    print(f"Style factors: {len(payload['meta']['styleFactors'])}")


if __name__ == "__main__":
    main()
