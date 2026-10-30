# IXN analysis interface

A guided browser interface around the existing IXN Python engine: data uploads,
study metadata, all soil/crop/hydrology parameters, review, execution, interactive
results, and downloadable XLSX/CSV/PDF/PNG output bundles.

The hosted version runs Python in a dedicated browser worker through Pyodide.
Input files remain in tab memory. The first run downloads the pinned Python
runtime and scientific packages from the same site; keep the tab open during calculation. Large
multi-site studies are better suited to the native Python version below.

## Run with native Python and server folder paths

Use the same Python environment as `IxN_RUN_ALL.ipynb`:

```bash
cd /users/4/kechc001/IXN_nitrate_leaching/interface
python serve.py --port 8765
```

Open `http://127.0.0.1:8765`. On a remote server, forward port 8765 through SSH.
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

All `Parameters` fields are exposed. Missing nitrate produces water-only results.
Missing moisture produces explicitly labeled WB_ETa fallback. The original
raw-data parsing/exclusion rules remain in force. Lab units, analyte basis,
sampling-date provenance and blank irrigation policy are explicit settings.

Download all outputs as a ZIP, or the Excel workbook, filtered plot-year CSV,
and plot-year PDF individually. Inspect the quality/validation tab and exported
manifest before interpreting results. Computation checks are not evidence of
field prediction accuracy.

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
