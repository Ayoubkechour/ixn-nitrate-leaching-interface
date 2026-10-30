# IXN nitrate leaching interface

A guided browser interface around the existing IXN Python engine: data uploads,
study metadata, all soil/crop/hydrology parameters, review, execution, interactive
results, and downloadable XLSX/CSV/PDF/PNG output bundles.

The GitHub Pages version runs Python in a dedicated browser worker through Pyodide.
Input files remain in tab memory. The first run downloads the pinned Python
runtime and scientific packages from the same site; keep the tab open during calculation. Large
multi-site studies are better suited to the native Python version below.

## Run with native Python and server folder paths

Use the same Python environment as `IxN_RUN_ALL.ipynb`:

```bash
cd ixn-nitrate-leaching-interface
python serve.py --port 8765
```

Open `http://127.0.0.1:8765` on the same machine. When the server runs remotely,
forward port 8765 from your laptop before opening that address, for example:

```bash
ssh -L 8765:127.0.0.1:8765 USER@SERVER
```
The local version adds a server folder path field and runs the exact same adapter
and model with native NumPy/pandas. Outputs are isolated in a temporary job
directory printed at startup; source files and `outputs_raw` are untouched.

For static/browser execution locally:

```bash
python -m http.server 8765 --directory dist
```

## Inputs and results

Choose prepared CSV/XLSX tables or the original Raw_data_NNI folder. The UI and
`dist/templates/input_guide.txt` list the required columns and explicit units.
One workbook with named Weather/Irrigation/Nitrate/Moisture/Plots sheets is
also supported. Individual files override the corresponding workbook sheet.
The included example and workbook contain synthetic data only.
The prepared soil-moisture input accepts the five raw PR2 VWC percentage columns
from the `Westport` sheet of `Master_PR2_SM.xlsx` (6, 12, 18, 24 and 36 inches).
Complete rows are integrated over the observed 0–0.9144 m depth, with the default
model profile matched to that depth. Incomplete rows remain missing, and the raw
readings are preserved in the input audit and depth chart. A supplied
`Observed_storage_mm` column remains supported for a complete configured profile.

All `Parameters` fields are exposed. Missing nitrate produces water-only results.
Missing moisture produces explicitly labeled WB_ETa fallback. The original
raw-data parsing/exclusion rules remain in force. Lab units, analyte basis,
sampling-date provenance and blank irrigation policy are explicit settings.

Download all outputs as a ZIP, or the Excel workbook, filtered plot-year CSV,
and plot-year PDF individually. Inspect the quality/validation tab and exported
manifest before interpreting results. Computation checks are not evidence of
field prediction accuracy.

Results can be filtered by site/year, irrigation and nitrogen treatment. The
daily chart can show any plot in the selected results; records load on demand.
The treatment/year tab reports counts, missing counts, mean, sample standard
deviation and range for the selected metric, with a separate CSV export. These
are descriptive summaries, not tests of treatment effects. The overview shows
nitrate and measured-water-balance coverage; unobserved values stay missing.

Westport 2023 uses the Westport 2022 plot/treatment layout, confirmed by the user
on 2026-10-30. Its weather, irrigation, moisture and nitrate remain from 2023.
An explicit current-year plot-map override still takes precedence. The source
workbook and confirmation are recorded in each raw run's provenance.

## Maintain and verify

`python build_assets.py` copies the five original engine modules byte-for-byte
into `dist/python`, records their SHA-256 hashes, and regenerates synthetic
templates. The interface adapter is separate in `interface_engine.py`; it does
not replace the model equations. No real field inputs or output datasets are
included in the hosted source.

`python vendor_runtime.py` restores the pinned Pyodide runtime and scientific
wheels, verifying package hashes. All runtime dependencies are served with the
site. No third-party requests are needed during a calculation.

Verification: `python test_interface.py` checks input failures and the real
plot-113 regression when local field data is available. The original model's
tests remain in `../test_leaching_model.py`. `test_browser.py` exercises both
execution paths using the optional Playwright dependency.

The design workflow was informed by the NASA POWER Data Access Viewer and
OpenET Data Explorer, with an original layout and visual styling.

- https://power.larc.nasa.gov/docs/tutorials/data-access-viewer/user-guide/
- https://etdata.org/openet-data-explorer/
