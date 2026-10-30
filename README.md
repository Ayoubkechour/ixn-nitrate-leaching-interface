# IXN nitrate leaching interface

**Website:** https://ayoubkechour.github.io/ixn-nitrate-leaching-interface/

The website runs the calculation in your browser. Use the local Python server
below when you want to read a folder path on the server or run larger studies.

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
The built-in demonstration is a synthetic 2022 site-year trial: 96 plots across
four irrigation treatments, six nitrogen treatments and four replicates. It
includes full-calendar-year weather and analyzes the May 16–October 31 growing
season, using April 1 preplant history. No real field measurements ship with
the public website.
The prepared soil-moisture input accepts the five raw PR2 VWC percentage columns
from the `Westport` sheet of `Master_PR2_SM.xlsx` (6, 12, 18, 24 and 36 inches).
Complete rows are integrated over the observed 0–0.9144 m depth, with the default
model profile matched to that depth. Missing or physically invalid readings
leave the measured profile missing; original values and invalid counts remain in
the input audit. The raw readings are visible in the depth chart. A supplied
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
The treatment matrix summarizes all plots in the selected site-year, with the
mean and observation count in each irrigation × nitrogen cell. It defaults to
modeled ET and can show the other metrics in the selector.
The ET panel offers monthly totals and cumulative curves for modeled actual ET
and weather-derived reference ET, inspired by OpenET's
[Data Explorer](https://etdata.org/openet-data-explorer/). These IXN quantities
are not OpenET satellite estimates.
The daily workspace separates water fluxes (mm/day), discrete nitrate samples
(mg/L), modeled versus measured profile storage (mm), and raw PR2 depth readings
(VWC %). The depth-by-date matrix leaves absent readings blank and marks
out-of-range values; a line view is available for depth trends. No samples are
interpolated for display. Every chart uses a labeled unit and date or plot axis.
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

The chart design follows published examples and guidance: the
[USGS water-quality trend viewer](https://apps.usgs.gov/trends/sw-quality/)
plots observed concentrations against time separately from modeled values;
[EPA data guidance](https://www.epa.gov/n-steps-online/data-considerations)
recommends time-series review of extreme values and retaining quality context;
and [soil-moisture visualization research](https://acsess.onlinelibrary.wiley.com/doi/full/10.2136/vzj2015.03.0037)
describes time series and depth profiles as complementary views.

- https://power.larc.nasa.gov/docs/tutorials/data-access-viewer/user-guide/
- https://etdata.org/openet-data-explorer/
