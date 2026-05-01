# Barra Frontend (GitHub Pages)

## Build payload

```powershell
python .\scripts\build_payload.py
```

This command reads:

- `..\data\tw_50_data\output\*.parquet`
- `..\data\tw_50_data\input\multi_industry.parquet`

and writes:

- `.\data\payload.json`

## Preview locally

Use any static server from `frontend` folder, for example:

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`.

## Deploy to GitHub Pages

Publish the contents of `frontend` (including `data/payload.json`) to your GitHub Pages branch/folder.
