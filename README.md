# Barra Frontend (GitHub Pages)

This frontend compares **multiple funds** from `tw_multiFund` and now includes:

- Multi-fund compare tab (max 5 funds)
- Sub-factor return attribution tab (cross-fund comparison by month)
- Factor return table tab (selected-month values + direction)
- Stock attribution tab (held stocks only, `w_port > 0`, dropdown selector)

## Data source

- `../data/tw_multiFund/output_full/*.parquet`

## Build payload

```powershell
python .\scripts\build_payload.py
```

Output:

- `./data/payload.json`

## Preview locally

```powershell
python -m http.server 8000
```

Open: `http://127.0.0.1:8000`

## Benchmark definition used in UI

- Dynamic Taiwan full-universe benchmark (TWSE + OTC)
- Monthly normalized by `exp(desc_size)`
- Next-month alignment (`holding_ym -> return_ym +1 month`)
