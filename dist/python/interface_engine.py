"""File/form adapter for the unchanged IXN scientific engine.

Works in CPython and Pyodide. Input paths are created by the host; no equations
are reimplemented here. User inputs are never copied into the published site.
"""
import hashlib
import io
import json
import math
import platform
import zipfile
from dataclasses import fields, replace
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from leaching_model import (Parameters, reference_et, simulate,
                            water_balance_intervals, leaching_intervals,
                            numeric_checked, parameters_dict)
from leaching_pipeline import summarize, tagged, scientific_checks, run
from leaching_results import plot_year_table, result_dictionary, draw_plot_year_figures


SCHEMAS = {
    'weather': ['Date', 'Tmax_C', 'Tmin_C', 'Wind_m_s', 'Rs_MJ_m2_day', 'Rain_mm'],
    'irrigation': ['Date', 'Plot', 'Irrigation_mm'],
    'nitrate': ['Date', 'Plot', 'Nitrate_mg_L'],
    'moisture': ['Date', 'Plot'],
    'plots': ['Plot', 'Irrigation_treatment', 'Nitrogen_treatment', 'Rep'],
}
PR2_COLUMNS = ['6in_VWC %', '12in_VWC %', '18in_VWC %', '24_inVWC %', '36in_VWC %']
PR2_DEPTH_M = 0.9144
PR2_CENTERS_M = np.array([6, 12, 18, 24, 36]) * 0.0254
PR2_WEIGHTS_MM = np.diff(np.r_[0, (PR2_CENTERS_M[:-1] + PR2_CENTERS_M[1:]) / 2, PR2_CENTERS_M[-1]]) * 1000


def parameters_from_form(values):
    values = dict(values or {})
    names = {f.name for f in fields(Parameters)}
    unknown = set(values) - names
    if unknown:
        raise ValueError('Unknown model settings: ' + ', '.join(sorted(unknown)))
    defaults = parameters_dict(Parameters())
    for name, value in values.items():
        default = defaults[name]
        if isinstance(default, (tuple, list)):
            if not isinstance(value, (list, tuple)) or not value:
                raise ValueError(name + ' must be a nonempty list of numbers.')
            value = tuple(float(v) for v in value)
        elif isinstance(default, bool):
            if not isinstance(value, bool):
                raise ValueError(name + ' must be true or false.')
        else:
            value = float(value)
        nums = value if isinstance(value, tuple) else (value,)
        if not all(math.isfinite(float(v)) for v in nums):
            raise ValueError(name + ' must contain finite numbers.')
        values[name] = value
    p = Parameters(**values)
    p.validate()
    if any(v < 0 for v in [p.kcb_initial, p.kcb_mid, p.kcb_end]):
        raise ValueError('Basal crop coefficients must be nonnegative.')
    if p.height_max_m <= 0 or p.climate_adjustment_height_m <= 0 or p.kcmax_wind_factor < 0:
        raise ValueError('Crop heights must be positive; wind factor cannot be negative.')
    if len(p.cn) != 3 or list(p.cn) != sorted(p.cn):
        raise ValueError('Supply three increasing curve numbers for dry/normal/wet conditions.')
    if len(p.antecedent_threshold_mm) != 2 or not 0 <= p.antecedent_threshold_mm[0] < p.antecedent_threshold_mm[1]:
        raise ValueError('Supply two increasing, nonnegative antecedent thresholds.')
    if any(v != int(v) for v in p.stage_days):
        raise ValueError('Crop stage lengths must be whole days.')
    return p


def read_table(path, role):
    path = Path(path)
    if path.suffix.lower() == '.csv':
        table = pd.read_csv(path)
    elif path.suffix.lower() == '.xlsx':
        if role == 'moisture':
            with pd.ExcelFile(path) as book:
                sheet = 'Westport' if 'Westport' in book.sheet_names else 0
                table = pd.read_excel(book, sheet_name=sheet)
        else:
            table = pd.read_excel(path)
    else:
        raise ValueError(role + ': use a CSV or XLSX file.')
    table.columns = table.columns.astype(str).str.strip()
    return table.dropna(how='all').reset_index(drop=True)


def validate_table(table, role):
    missing = set(SCHEMAS[role]) - set(table.columns)
    if missing:
        raise ValueError(role.capitalize() + ': missing columns ' + ', '.join(sorted(missing)))
    if table.empty and role in ['weather', 'irrigation', 'plots']:
        raise ValueError(role.capitalize() + ' table is empty.')
    if 'Date' in table:
        table['Date'] = pd.to_datetime(table.Date, errors='raise').dt.normalize()
        if table.Date.isna().any():
            raise ValueError(role.capitalize() + ': dates cannot be blank.')
    if 'Plot' in table:
        numeric_checked(table, ['Plot'])
        if (table.Plot != np.floor(table.Plot)).any() or (table.Plot <= 0).any():
            raise ValueError(role.capitalize() + ': plot IDs must be positive whole numbers.')
        table['Plot'] = table.Plot.astype(int)
    keys = ['Date'] if role == 'weather' else ['Plot'] if role == 'plots' else ['Date', 'Plot']
    if table.duplicated(keys).any():
        duplicate = table.loc[table.duplicated(keys, keep=False), keys].iloc[0].to_dict()
        raise ValueError(role.capitalize() + ': duplicate records for ' + str(duplicate) + '. Resolve replicates before upload.')
    if role == 'moisture':
        raw = set(PR2_COLUMNS) <= set(table.columns)
        if raw and 'Observed_storage_mm' in table:
            raise ValueError('Moisture: supply either the five raw PR2 VWC columns or Observed_storage_mm, not both.')
        if raw:
            numeric_checked(table, PR2_COLUMNS, allow_missing=True)
            values = table[PR2_COLUMNS]
            invalid = (values < 0) | (values > 100)
            valid_values = values.mask(invalid)
            table['Invalid_VWC_count'] = invalid.sum(axis=1)
            table['Complete_profile'] = valid_values.notna().all(axis=1)
            table['Observed_storage_mm'] = valid_values.div(100).mul(PR2_WEIGHTS_MM, axis=1).sum(axis=1, min_count=len(PR2_COLUMNS))
            table['Profile_depth_m'] = PR2_DEPTH_M
        elif 'Observed_storage_mm' not in table:
            missing_depths = [name for name in PR2_COLUMNS if name not in table]
            raise ValueError('Moisture: supply Observed_storage_mm or all five PR2 columns. Missing: ' + ', '.join(missing_depths))
    return table


def prepared_tables(files):
    tables = {}
    if files.get('workbook'):
        with pd.ExcelFile(files['workbook']) as book:
            sheets = {name.strip().lower(): name for name in book.sheet_names}
            for role in SCHEMAS:
                if role in sheets:
                    tables[role] = pd.read_excel(book, sheet_name=sheets[role]).dropna(how='all')
                    tables[role].columns = tables[role].columns.astype(str).str.strip()
    for role in SCHEMAS:
        if files.get(role):
            tables[role] = read_table(files[role], role)
    for role in ['weather', 'irrigation']:
        if role not in tables:
            raise ValueError('Upload ' + role + '.csv/.xlsx or a workbook with a ' + role.capitalize() + ' sheet.')
    return {role: validate_table(table, role) for role, table in tables.items()}


def json_records(table):
    return json.loads(table.to_json(orient='records', date_format='iso'))


def analyze(request, workspace, progress=print):
    workspace = Path(workspace)
    output = workspace / 'results'
    output.mkdir(parents=True, exist_ok=True)
    files = request.get('files', {})
    p = parameters_from_form(request.get('parameters'))
    issues = []
    def note(message, scope='inputs', severity='review'):
        issues.append(dict(scope=scope, severity=severity, message=message))
    mode = request.get('mode', 'tables')
    basis = request.get('nitrate_basis', 'unverified')
    method = request.get('concentration_method', 'end_sample')
    if basis not in ['unverified', 'NO3-N', 'NO3'] or method not in ['end_sample', 'linear']:
        raise ValueError('Select a valid analyte basis and concentration method.')
    if mode == 'raw':
        raw_root = request.get('raw_root')
        if not raw_root:
            raise ValueError('Choose your Raw_data_NNI folder or enter its server path.')
        cfg = dict(raw_root=raw_root, output_dir=str(output), reference_workbook=None,
                   sites=request.get('sites', ['Becker', 'Westport']), years=request.get('years', [2021, 2022, 2023]),
                   nitrate_basis=basis, concentration_method=method,
                   blank_irrigation_policy=request.get('blank_irrigation_policy', 'error'),
                   sensitivity=bool(request.get('sensitivity', False)))
        if not cfg['sites'] or not cfg['years']:
            raise ValueError('Choose at least one raw-data site and year.')
        if files.get('collection_calendar'):
            cfg['nitrate_collection_calendar'] = files['collection_calendar']
        if files.get('run_config'):
            extra = json.loads(Path(files['run_config']).read_text())
            allowed = {'planting_overrides', 'end_overrides', 'plot_plan_overrides'}
            if set(extra) - allowed:
                raise ValueError('Raw configuration supports only planting_overrides, end_overrides and plot_plan_overrides.')
            # Uploaded plot maps are resolved by name inside the selected folder.
            maps = {}
            for key, value in extra.get('plot_plan_overrides', {}).items():
                candidate = (Path(raw_root) / value).resolve()
                if Path(raw_root).resolve() not in candidate.parents:
                    raise ValueError('Plot-map paths must stay within the raw input folder.')
                maps[key] = str(candidate)
            extra['plot_plan_overrides'] = maps
            cfg.update(extra)
        progress('Reading raw weather, irrigation, lab samples, moisture and treatment plans…')
        results = run(cfg, p, progress)
        plot_year = results['plot_year']
        daily = results['daily']
        checks = results['checks']
        quality = results['data_quality']
    elif mode == 'tables':
        progress('Checking uploaded tables and calculation settings…')
        tables = prepared_tables(files)
        pr2_input = 'moisture' in tables and set(PR2_COLUMNS) <= set(tables['moisture'].columns)
        if pr2_input:
            if tuple(p.soil_bottom_m) == (0.30, 0.60, 0.90, 1.20):
                p = replace(p, soil_bottom_m=(0.30, 0.60, 0.90, PR2_DEPTH_M))
                note('Raw PR2 VWC percentages integrated over 0–0.9144 m using midpoint cells. The default model profile was set to 0.9144 m to match the deepest sensor; no values were extrapolated to 1.2 m.', 'water balance')
            elif not math.isclose(p.soil_bottom_m[-1], PR2_DEPTH_M, abs_tol=1e-6):
                raise ValueError('Raw PR2 readings cover 0–0.9144 m. Set the final soil layer bottom to 0.9144 m, or upload a complete Observed_storage_mm profile at your configured depth.')
            incomplete = int((~tables['moisture'].Complete_profile).sum())
            invalid = int(tables['moisture'].Invalid_VWC_count.sum())
            if invalid:
                note(f'{invalid} PR2 VWC readings outside physical 0–100% were preserved in the input audit and excluded from storage integration.', 'water balance')
            if incomplete:
                note(f'{incomplete} PR2 rows have missing depths; they remain in the input audit but are excluded from measured storage and water-balance intervals.', 'water balance')
        if not request.get('irrigation_complete'):
            raise ValueError('Confirm that the irrigation table is a complete event log. Unlisted days are treated as zero irrigation.')
        planting = pd.Timestamp(request.get('planting_date'))
        end = pd.Timestamp(request.get('end_date'))
        if pd.isna(planting) or pd.isna(end) or end < planting or end.year != planting.year:
            raise ValueError('Use valid planting and end dates within one calendar year, with end on or after planting.')
        latitude = float(request.get('latitude_deg', 45.34399))
        elevation = float(request.get('elevation_m', 287.1216))
        wind_height = float(request.get('wind_height_m', 3))
        if not all(math.isfinite(v) for v in [latitude, elevation, wind_height]):
            raise ValueError('Station metadata must be finite numbers.')
        weather = tables['weather'].sort_values('Date')
        weather = weather.loc[weather.Date <= end].copy()
        if weather.empty or weather.Date.min() > planting or weather.Date.max() != end:
            raise ValueError('Weather must cover planting through the selected end date, including the final day.')
        expected = pd.date_range(weather.Date.min(), end)
        gaps = expected.difference(weather.Date)
        if len(gaps):
            raise ValueError('Weather has missing days: ' + ', '.join(str(d.date()) for d in gaps[:8]))
        if weather.Date.min() > planting - pd.Timedelta(days=5):
            note('Less than five preplant weather days: antecedent runoff history is incomplete.')
        if {'Tdew_C', 'RHmin_pct', 'RHmax_pct'} <= set(weather.columns):
            note('Both humidity sources supplied; paired RH extrema take precedence, following the engine.')
        weather = reference_et(weather, latitude, elevation, wind_height, p.albedo)
        irr = tables['irrigation'].copy()
        numeric_checked(irr, ['Irrigation_mm'], allow_missing=True)
        if (irr.Irrigation_mm.dropna() < 0).any():
            raise ValueError('Irrigation amounts cannot be negative.')
        irr['Blank_irrigation_imputed'] = irr.Irrigation_mm.isna()
        irr['Irrigation_observed_mm'] = irr.Irrigation_mm
        if irr.Blank_irrigation_imputed.any():
            if request.get('blank_irrigation_policy', 'error') != 'flag_zero':
                raise ValueError('Irrigation has blank amounts. Complete the log or explicitly select the flagged zero-fill scenario.')
            note('Blank logged irrigation amounts modeled as zero under the selected conditional scenario.')
        irr['Irrigation_mm'] = irr.Irrigation_mm.fillna(0)
        for role, col in [('nitrate', 'Nitrate_mg_L'), ('moisture', 'Observed_storage_mm')]:
            if role in tables:
                numeric_checked(tables[role], [col], allow_missing=True)
                if (tables[role][col].dropna() < 0).any():
                    raise ValueError(role.capitalize() + ': negative measurements are invalid.')
                if role == 'nitrate':
                    sentinel = tables[role][col].isin([999, 9999])
                    if sentinel.any():
                        tables[role].loc[sentinel, col] = np.nan
                        note(str(int(sentinel.sum())) + ' nitrate sentinels (999/9999) retained as missing.')
        if 'nitrate' in tables:
            units = request.get('concentration_units', 'unverified')
            if units == 'unverified':
                note('Lab concentration units unverified; mg/L is assumed. Loads are provisional.')
            elif units == 'ug/L':
                tables['nitrate']['Nitrate_mg_L'] /= 1000
            elif units != 'mg/L':
                raise ValueError('Select mg/L, µg/L, or unverified concentration units.')
            if not request.get('collection_dates_verified'):
                note('Nitrate dates are not verified collection dates; loads are provisional.')
            if basis == 'unverified':
                note('NO3 versus NO3-N is unverified; nitrogen-mass load remains missing.')
        else:
            note('No nitrate file: water balance and drainage only; load remains missing.')
        plots = set(irr.Plot)
        for role in ['nitrate', 'moisture']:
            if role in tables:
                plots.update(tables[role].Plot)
        if 'plots' in tables:
            plan = tables['plots'].copy()
            if plots - set(plan.Plot):
                raise ValueError('The plot plan does not cover these observed plots: ' + str(sorted(plots-set(plan.Plot))))
            if plan[['Irrigation_treatment', 'Nitrogen_treatment', 'Rep']].isna().any().any():
                raise ValueError('Treatment names and replicate values in the plot plan cannot be blank.')
            numeric_checked(plan, ['Rep'])
            if (plan.Rep != np.floor(plan.Rep)).any():
                raise ValueError('Replicate values must be whole numbers.')
            plan['Rep'] = plan.Rep.astype(int)
        else:
            plan = pd.DataFrame([dict(Plot=plot, Irrigation_treatment='Unspecified', Nitrogen_treatment='Unspecified', Rep=0) for plot in sorted(plots)])
            note('No plot plan supplied; treatments remain Unspecified and replicate is 0.')
        if not len(plan):
            raise ValueError('No plot IDs found in the inputs.')
        site = str(request.get('site', '')).strip()
        dataset = str(request.get('dataset', '')).strip()
        if not site or not dataset:
            raise ValueError('Enter a site name and dataset name.')
        for role, table in tables.items():
            if role != 'weather' and 'Date' in table:
                outside = ~table.Date.between(weather.Date.min(), end)
                if outside.any():
                    note(f'{role}: {int(outside.sum())} observations fall outside the supplied weather/model period and are not used.')
        note('Soil and crop settings are user supplied; numerical checks do not establish field prediction accuracy.', 'parameters')
        note('Moisture is end-of-day storage over the configured profile depth. WB_ETa uses modeled fallback outside paired complete profiles.', 'water balance')
        note('Load covers only paired, valid in-season nitrate samples; no seasonal extrapolation.', 'leaching')
        all_daily, all_wb, all_load, summaries = [], [], [], []
        comparison = []
        for index, row in enumerate(plan.itertuples(index=False)):
            progress(f'Calculating plot {row.Plot} ({index+1}/{len(plan)})…')
            d = weather.merge(irr.loc[irr.Plot == row.Plot, ['Date', 'Irrigation_mm', 'Irrigation_observed_mm', 'Blank_irrigation_imputed']], on='Date', how='left', validate='one_to_one')
            d['Irrigation_mm'] = d.Irrigation_mm.fillna(0)
            d['Blank_irrigation_imputed'] = d.Blank_irrigation_imputed.fillna(False).astype(bool)
            for role, col in [('moisture', 'Observed_storage_mm'), ('nitrate', 'Nitrate_mg_L')]:
                if role in tables:
                    columns = ['Date', col] + (PR2_COLUMNS if role == 'moisture' and pr2_input else [])
                    obs = tables[role].loc[tables[role].Plot == row.Plot, columns]
                    d = d.merge(obs, on='Date', how='left', validate='one_to_one')
                else:
                    d[col] = np.nan
            full = simulate(d, planting, p)
            season = full.loc[full.Date.between(planting, end)].copy()
            season.attrs['planting_date'] = planting
            wb = water_balance_intervals(season)
            load = leaching_intervals(season, basis, method)
            alt = leaching_intervals(season, basis, 'linear' if method == 'end_sample' else 'end_sample')
            metadata = dict(Dataset=dataset, Site=site, Year=planting.year, Plot=int(row.Plot),
                            Irrigation_treatment=str(row.Irrigation_treatment), Nitrogen_treatment=str(row.Nitrogen_treatment),
                            Rep=int(row.Rep), Profile_depth_m=p.soil_bottom_m[-1])
            summary = summarize(season, wb, load, metadata)
            summary['Result_status'] = 'provisional_user_inputs_and_parameters'
            if load.empty:
                summary['Result_status'] = 'water_model_only_no_nitrate_intervals'
            elif summary['Blank_irrigation_days']:
                summary['Result_status'] = 'provisional_blank_irrigation_zero_scenario'
            summaries.append(summary)
            if load.empty and 'nitrate' in tables:
                note(f'Plot {row.Plot}: fewer than two valid in-season nitrate dates; load remains missing.')
            if summary['Storage_below_WP_days']:
                note(f'Plot {row.Plot}: modeled storage below wilting point on {summary["Storage_below_WP_days"]} days; review soil/initial settings.', 'hydrology')
            if summary['Negative_WB_intervals']:
                note(f'Plot {row.Plot}: {summary["Negative_WB_intervals"]} negative measured WB ET intervals retained for review.', 'water balance')
            all_daily.append(tagged(season, metadata))
            all_wb.append(tagged(wb, metadata))
            if not load.empty:
                all_load.append(tagged(load, metadata))
            comparison.append(dict(metadata, Main_method=method,
                Main_load_kg_ha=float(load.Load_reported_analyte_kg_ha.sum()) if len(load) else np.nan,
                Alternative_load_kg_ha=float(alt.Load_reported_analyte_kg_ha.sum()) if len(alt) else np.nan))
        daily = pd.concat(all_daily, ignore_index=True)
        wb = pd.concat(all_wb, ignore_index=True)
        load = pd.concat(all_load, ignore_index=True) if all_load else pd.DataFrame()
        summary = pd.DataFrame(summaries)
        plot_year = plot_year_table(summary)
        checks = scientific_checks(daily, wb, load)
        quality = pd.DataFrame(issues, columns=['scope', 'severity', 'message'])
        progress('Generating plot-year figures and downloadable reports…')
        figures = draw_plot_year_figures(plot_year, output)
        metrics = ['ETa_model_mm', 'ETa_Actual_mm', 'Drainage_mm', 'Load_reported_analyte_kg_ha']
        treatment = summary.groupby(['Dataset', 'Site', 'Year', 'Irrigation_treatment', 'Nitrogen_treatment'])[metrics].agg(['count', 'mean', 'std'])
        treatment.columns = ['_'.join(c) for c in treatment.columns]
        export = dict(plot_year_results=plot_year, plot_summary=summary, water_balance_intervals=wb,
                      leaching_intervals=load, validation=checks, data_quality=quality,
                      result_column_definitions=result_dictionary(), treatment_summary=treatment.reset_index(),
                      concentration_comparison=pd.DataFrame(comparison), figure_index=figures)
        with pd.ExcelWriter(output/'results.xlsx', engine='openpyxl') as writer:
            for name, table in export.items():
                table.to_csv(output/(name+'.csv'), index=False)
                table.to_excel(writer, sheet_name=name[:31], index=False)
        for role, table in tables.items():
            table.to_csv(output/('input_'+role+'.csv'), index=False)
        daily.to_csv(output/'daily_water_balance.csv.gz', index=False, compression='gzip')
        manifest = dict(config={k:v for k,v in request.items() if k != 'files'}, parameters=parameters_dict(p),
            inputs=[dict(role=role, name=Path(path).name, sha256=hashlib.sha256(Path(path).read_bytes()).hexdigest()) for role,path in files.items()],
            implementation={name:hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest() for name in ['leaching_model.py','leaching_pipeline.py','leaching_results.py','interface_engine.py']},
            software=dict(python=platform.python_version(), pandas=pd.__version__, numpy=np.__version__, matplotlib=matplotlib.__version__),
            plots=len(summary), daily_rows=len(daily), validation_passed=bool(checks.Passed.all()),
            result_status='provisional_user_inputs_and_parameters')
        (output/'run_manifest.json').write_text(json.dumps(manifest, indent=2, default=str))
    else:
        raise ValueError('Choose prepared tables or a raw IXN folder.')
    progress('Packaging outputs…')
    # Load daily charts on demand rather than sending every plot to the browser.
    preview_folder = workspace/'daily_previews'
    preview_folder.mkdir(exist_ok=True)
    daily_columns = ['Date', 'Rain_mm', 'Irrigation_mm', 'ETa_model_mm', 'Drainage_mm', 'Storage_end_mm', 'Observed_storage_mm', 'Nitrate_mg_L'] + PR2_COLUMNS
    identities = ['Dataset', 'Site', 'Year', 'Plot']
    daily_plots = []
    for index, (identity, group) in enumerate(daily.groupby(identities, sort=True)):
        records = json_records(group.sort_values('Date')[[c for c in daily_columns if c in group]])
        (preview_folder/(str(index)+'.json')).write_text(json.dumps(records, allow_nan=False))
        daily_plots.append(dict(id=str(index), **dict(zip(identities, identity))))
    first = plot_year.iloc[0]
    first_preview = next(item for item in daily_plots if all(item[key] == first[key] for key in identities))
    payload = dict(plot_year=json_records(plot_year), checks=json_records(checks), issues=json_records(quality),
        daily=json.loads((preview_folder/(first_preview['id']+'.json')).read_text()),
        daily_plots=json_records(pd.DataFrame(daily_plots)), daily_id=first_preview['id'],
        daily_plot=int(first.Plot), daily_rows=len(daily),
        figures=[str(path.relative_to(output)) for path in sorted(output.rglob('*.png'))],
        status='provisional', plot_count=len(plot_year))
    archive = workspace/'ixn_results.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for path in sorted(output.rglob('*')):
            if path.is_file():
                z.write(path, path.relative_to(output))
    return payload, archive
