"""Run the analysis from raw inputs, write tables/figures and validate invariants."""
from dataclasses import replace
from pathlib import Path
import hashlib
import json
import platform
import numpy as np
import pandas as pd
import matplotlib
import matplotlib.pyplot as plt
from leaching_model import (Parameters, simulate, water_balance_intervals,
                            leaching_intervals, parameters_dict)
from leaching_sources import Sources, PLANTING, UnverifiedPlotPlan
from leaching_results import plot_year_table, result_dictionary, draw_plot_year_figures

PROJECT = Path(__file__).resolve().parent
DEFAULT_RAW = PROJECT.parent/'Raw_data_NNI'
KEYS = ['Dataset','Site','Year','Plot','Irrigation_treatment','Nitrogen_treatment','Rep']
WESTPORT_HARVEST = {2021:'2021-11-03',2022:'2022-10-18',2023:'2023-10-17',2024:'2024-10-24'}


def config_default():
    return dict(raw_root=str(DEFAULT_RAW), output_dir=str(PROJECT/'outputs_raw'),
                sites=['Becker','Westport'], years=[2021,2022,2023],
                nitrate_basis='unverified', concentration_method='end_sample',
                nitrate_collection_calendar=None, sensitivity=True,
                blank_irrigation_policy='flag_zero',
                reference_workbook=str(PROJECT/'113_2022_IxN_Becker_I1N1.xlsx'),
                planting_overrides={}, end_overrides={}, plot_plan_overrides={}, custom_datasets=[])


def tagged(df, metadata):
    df = df.copy()
    for k,v in metadata.items():
        df[k] = v
    return df


def total_or_missing(df, col):
    return float(df[col].sum(min_count=1)) if col in df else np.nan


def summarize(d, wb, load, metadata):
    measured_wb = wb.loc[wb.WB_method == 'measured_balance'] if not wb.empty else wb
    result = dict(metadata)
    for c in ['Rain_mm','Irrigation_mm','Runoff_mm','ETo_mm','ETr_mm','ETa_model_mm',
              'Evaporation_mm','Transpiration_mm','Drainage_mm','Assimilation_mm','GDD_F_day']:
        result[c] = float(d[c].sum())
    result.update(Start_date=d.Date.min(), End_date=d.Date.max(), Days=len(d),
                  Storage_initial_mm=d.Storage_start_mm.iloc[0], Storage_final_mm=d.Storage_end_mm.iloc[-1],
                  Observed_profiles=int(d.Observed_storage_mm.notna().sum()),
                  Nitrate_dates=int(d.get('Nitrate_mg_L', pd.Series(dtype=float)).notna().sum()),
                  WB_intervals=len(measured_wb), WB_days=int(measured_wb.Days.sum()) if not measured_wb.empty else 0,
                  Actual_ET_intervals=len(wb), ETa_Actual_mm=total_or_missing(wb,'ETa_Actual_mm'),
                  ETa_fallback_mm=total_or_missing(wb.loc[wb.WB_method == 'two_step_fallback'],'ETa_model_mm') if not wb.empty else np.nan,
                  ETa_WB_covered_mm=total_or_missing(measured_wb,'ETa_WB_mm'),
                  ETa_model_WB_covered_mm=total_or_missing(measured_wb,'ETa_model_mm'),
                  Negative_WB_intervals=int(wb.WB_negative.sum()) if not wb.empty else 0,
                  Leaching_intervals=len(load), Leaching_days=int(load.Days.sum()) if not load.empty else 0,
                  Drainage_nitrate_covered_mm=total_or_missing(load,'Drainage_mm'),
                  Load_reported_analyte_kg_ha=total_or_missing(load,'Load_reported_analyte_kg_ha'),
                  Load_reported_analyte_lb_ac=total_or_missing(load,'Load_reported_analyte_lb_ac'),
                  Load_N_kg_ha=total_or_missing(load,'Load_N_kg_ha'),
                  Max_balance_residual_mm=float(d.Balance_residual_mm.abs().max()),
                  Observation_outside_FC_WP_days=int(d.Observation_outside_FC_WP.sum()),
                  Storage_below_WP_days=int(d.Storage_below_WP.sum()),
                  Mean_Ks=float(d.Ks.mean()), Water_stress_days=int((d.Ks < 0.999).sum()),
                  Blank_irrigation_days=int(d.get('Blank_irrigation_imputed',pd.Series(dtype=bool)).sum()),
                  Model_profile_depth_m=metadata.get('Profile_depth_m',1.2),
                  Concentration_basis=load.Concentration_basis.iloc[0] if not load.empty else 'unavailable',
                  Result_status='provisional_model_and_lab_date_proxy')
    if not len(load):
        result['Result_status'] = 'water_model_only_no_nitrate_intervals'
    elif result['Blank_irrigation_days'] > 0:
        result['Result_status'] = 'provisional_blank_irrigation_zero_scenario'
    return result


def scientific_checks(d, wb, loads):
    checks = []
    def check(name, value, details):
        checks.append(dict(Check=name, Passed=bool(value), Details=details))
    check('unique daily site/year/plot/date', not d.duplicated(['Dataset','Site','Year','Plot','Date']).any(), 'Reject duplicated joins before summing fluxes.')
    error = float(d.Balance_residual_mm.abs().max())
    check('daily water mass conservation', error < 1e-8, f'Max |P+I+A-ET-RO-DP-dS|={error:.3g} mm; A is explicit assimilation.')
    check('physical coefficients', d[['Ks','Kr']].ge(0).all().all() and d[['Ks','Kr']].le(1).all().all(), 'Ks and Kr within [0,1].')
    check('nonnegative modeled fluxes', d[['Drainage_mm','Runoff_mm','ETa_model_mm','Evaporation_mm','Transpiration_mm']].ge(-1e-9).all().all(), 'Negative observed water-balance ET is flagged, never clipped.')
    error_et = float((d.ETa_model_mm-d.Evaporation_mm-d.Transpiration_mm).abs().max())
    check('ET component partition', error_et < 1e-9, 'ETa = evaporation + transpiration.')
    check('finite modeled daily values', np.isfinite(d[['ETo_mm','ETa_model_mm','Drainage_mm','Storage_end_mm']]).all().all(), 'Missing observations remain NaN; modeled outputs must be finite.')
    if not wb.empty:
        error = float(wb.Model_budget_closure_mm.abs().max())
        check('interval water conservation', error < 1e-8, f'Max model interval closure={error:.3g} mm; measured WB residuals and assimilation remain explicit.')
        for _, g in wb.groupby(['Dataset','Site','Year','Plot']):
            ordered = g.sort_values('Start_date')
            if (ordered.Start_date.iloc[1:].to_numpy() < ordered.End_date.iloc[:-1].to_numpy()).any():
                raise AssertionError('Overlapping WB intervals.')
        check('WB intervals do not overlap', True, 'All intervals use (start, end], each day at most once.')
    if not loads.empty:
        check('unique leaching intervals', not loads.duplicated(['Dataset','Site','Year','Plot','Start_date','End_date']).any(), 'Each interval load stored once; no extrapolation outside sample coverage.')
    result = pd.DataFrame(checks)
    if not result.Passed.all():
        raise AssertionError(result.loc[~result.Passed].to_string(index=False))
    return result


def run(config=None, parameters=None, progress=print):
    cfg = config_default()
    if config:
        cfg.update(config)
    p = parameters or Parameters()
    p.validate()
    src = Sources(cfg['raw_root'], PROJECT)
    output = Path(cfg['output_dir']).resolve()
    if output == src.root or src.root in output.parents:
        raise ValueError('Outputs must not be written into Raw_data_NNI.')
    output.mkdir(parents=True, exist_ok=True)
    workbook_checks, workbook_issues = pd.DataFrame(), pd.DataFrame()
    if cfg['reference_workbook']:
        from workbook_validation import validate_workbook
        src.record(cfg['reference_workbook'], 'user-provided one-plot calculation reference; not raw field data')
        workbook_checks, workbook_issues = validate_workbook(cfg['reference_workbook'])
        if not workbook_checks.Passed.all():
            raise AssertionError('Reference workbook equation checks failed.')
        progress(f'Reference workbook: {len(workbook_checks)} equation/recurrence checks passed.')
    irr = src.irrigation(cfg['blank_irrigation_policy'])
    sm = src.moisture()
    nitrate = src.nitrate(cfg['nitrate_collection_calendar'])
    src.issue('parameters', 'Original FC/WP, Kcb, stages, MAD, CN and surface constants retained in Parameters; no site calibration provided. Transfer of these soil constants to Westport is provisional.')
    src.issue('hydrology', 'IXN/113 workbook sequence: previous absolute profile depletion determines Ks, then ETadj, DP and measured depletion reset. April 1 history initializes the recurrence; initial depletion=0. Capillary rise and lateral exchange assumed zero. Soil observations treated as end-of-day; reset capped at field capacity as original.')
    src.issue('legacy exports', 'User instruction: 101.xlsx, 113.xlsx, 114.xlsx, test1.xlsx and existing derived analysis workbooks are excluded from all inputs and validation.')
    datasets, dataset_status = [], []
    for site in cfg['sites']:
        for year in cfg['years']:
            scope = f'{site}-{year}'
            planting = cfg['planting_overrides'].get(scope, PLANTING.get(site,{}).get(year))
            if planting is None:
                raise ValueError('No documented planting date for '+scope)
            if year == 2024 and site == 'Becker' and scope not in cfg['planting_overrides']:
                raise ValueError('Provide verified Becker-2024 planting date in planting_overrides; irrigation date is not planting evidence.')
            end = cfg['end_overrides'].get(scope, WESTPORT_HARVEST[year] if site == 'Westport' else (f'{year}-10-31' if year == 2022 else f'{year}-10-30'))
            if site == 'Becker' and scope not in cfg['end_overrides']:
                src.issue(scope, 'Becker 2022 uses October 31 from the supplied reference workbook; other Becker years retain October 30 modeling cutoff. Override end_overrides for verified harvest dates.')
            try:
                plan = src.plot_plan(site, year, cfg['plot_plan_overrides'].get(scope))
            except UnverifiedPlotPlan as error:
                src.issue(scope,str(error),severity='excluded')
                dataset_status.append(dict(Site=site,Year=year,Status='excluded_unverified_plot_plan',Plots=0,Reason=str(error)))
                progress(f'Excluded {scope}: unverified plot-treatment protocol (see dataset_status).')
                continue
            w = src.weather(site, year, planting, end, p)
            events = irr.loc[(irr.Site == site) & (irr.Year == year)]
            needed = set(plan.Irrigation_treatment)
            if not needed <= set(events.Irrigation_treatment):
                raise ValueError('Missing irrigation treatment records for '+scope)
            n = nitrate.loc[(nitrate.Site == site) & (nitrate.Year == year)]
            m = sm.loc[sm.Date.dt.year == year] if site == 'Westport' else sm.iloc[:0]
            observed_ids = set(n.Plot) | set(m.Plot)
            if observed_ids - set(plan.Plot):
                src.issue(scope, 'Samples with plot IDs absent from protocol excluded: '+str(sorted(observed_ids-set(plan.Plot))))
            # Analyze plots with lab or soil observations. If no observations, full plan.
            if observed_ids:
                plan = plan.loc[plan.Plot.isin(observed_ids)]
            dataset_status.append(dict(Site=site,Year=year,Status='included',Plots=len(plan),Reason=plan.attrs.get('provenance', 'Raw inputs and compatible plot-treatment protocol available.')))
            profile_p = replace(p, soil_bottom_m=(0.30,0.60,0.90,0.9144)) if site == 'Westport' else p
            for row in plan.itertuples(index=False):
                di = events.loc[events.Irrigation_treatment == row.Irrigation_treatment, ['Date','Irrigation_mm','Irrigation_observed_mm','Blank_irrigation_imputed']]
                d = w.merge(di, on='Date', how='left', validate='one_to_one')
                # Zero means no logged irrigation event; it is not used for blank logged events.
                d['Irrigation_mm'] = d.Irrigation_mm.fillna(0)
                d['Blank_irrigation_imputed'] = d.Blank_irrigation_imputed.fillna(False).astype(bool)
                d['Irrigation_observed_mm'] = d.Irrigation_observed_mm.where(d.Blank_irrigation_imputed, d.Irrigation_observed_mm.fillna(0))
                # Retain the measured PR2 depths for the interface's depth-by-date view.
                # Sources.moisture stores VWC as fractions after validation; the named
                # source columns are percentages in the raw workbook and chart.
                sensor_cols = ['6in_VWC %','12in_VWC %','18in_VWC %','24_inVWC %','36in_VWC %']
                dm = m.loc[m.Plot == row.Plot, ['Date','Observed_storage_mm'] + sensor_cols].copy()
                dm[sensor_cols] = dm[sensor_cols] * 100
                dn = n.loc[n.Plot == row.Plot, ['Date','Nitrate_mg_L','Valid_positions','Valid_lab_samples']]
                d = d.merge(dm, on='Date', how='left', validate='one_to_one').merge(dn, on='Date', how='left', validate='one_to_one')
                meta = dict(Dataset='raw_IXN', Site=site, Year=year, Plot=int(row.Plot),
                            Irrigation_treatment=row.Irrigation_treatment,
                            Nitrogen_treatment=row.Nitrogen_treatment, Rep=int(row.Rep),
                            Profile_depth_m=profile_p.soil_bottom_m[-1])
                datasets.append((meta,d,planting,profile_p))
            src.issue(scope, f'{len(plan)} plots included; {len(n)} lab plot/date records available. Nitrate intervals outside planting–end are excluded; results cover only paired valid sample dates.')
    if cfg['custom_datasets']:
        from leaching_sources import standardized_dataset
        for custom in cfg['custom_datasets']:
            custom = dict(custom)
            basis = custom.pop('nitrate_basis', cfg['nitrate_basis'])
            custom_p = Parameters(**custom.pop('parameters', parameters_dict(p)))
            custom_p.validate()
            folder = Path(custom['folder'])
            for filename in ['weather.csv','irrigation.csv','moisture.csv','nitrate.csv']:
                path = folder/filename
                if path.exists():
                    src.record(path, 'custom standardized input '+filename)
            additions = standardized_dataset(p=custom_p, **custom)
            for meta,d,planting,cp in additions:
                meta['Nitrate_basis_override'] = basis
                datasets.append((meta,d,planting,cp))
    if not datasets:
        raise ValueError('No datasets selected.')
    daily_all, wb_all, load_all, summaries, comparisons, sensitivities = [], [], [], [], [], []
    representative = set()
    for index, (meta,d,planting,cp) in enumerate(datasets):
        if index % 48 == 0:
            progress(f'Analyzing plot {index+1}/{len(datasets)}: {meta["Site"]} {meta["Year"]}')
        full_history = simulate(d, planting, cp)
        modeled = full_history.loc[full_history.Date >= pd.Timestamp(planting)].copy()
        modeled.attrs['planting_date'] = pd.Timestamp(planting)
        wb = water_balance_intervals(modeled)
        basis = meta.get('Nitrate_basis_override',cfg['nitrate_basis'])
        load = leaching_intervals(modeled, basis, cfg['concentration_method'])
        other_method = 'linear' if cfg['concentration_method'] == 'end_sample' else 'end_sample'
        alternative = leaching_intervals(modeled, basis, other_method)
        legacy_threshold = modeled.copy()
        if 'Nitrate_mg_L' in legacy_threshold:
            legacy_threshold.loc[legacy_threshold.Nitrate_mg_L > 65.75,'Nitrate_mg_L'] = 0
        legacy_load = leaching_intervals(legacy_threshold, basis, cfg['concentration_method'])
        daily_all.append(tagged(modeled,meta))
        if not wb.empty:
            wb_all.append(tagged(wb,meta))
        if not load.empty:
            load_all.append(tagged(load,meta))
        summaries.append(summarize(modeled,wb,load,meta))
        comparisons.append(dict(meta, Main_method=cfg['concentration_method'], Alternative_method=other_method,
                                Main_load_kg_ha=total_or_missing(load,'Load_reported_analyte_kg_ha'),
                                Alternative_load_kg_ha=total_or_missing(alternative,'Load_reported_analyte_kg_ha'),
                                Legacy_zero_above_65p75_load_kg_ha=total_or_missing(legacy_load,'Load_reported_analyte_kg_ha')))
        group = (meta['Dataset'],meta['Site'],meta['Year'])
        if cfg['sensitivity'] and group not in representative and len(load):
            representative.add(group)
            scenarios = {'baseline':cp, 'initial_half_AWC':replace(cp,profile_depletion_initial_mm=cp.capacity(cp.soil_bottom_m[-1],True)*0.5),
                         'Kcb_mid_minus_10pct':replace(cp,kcb_mid=cp.kcb_mid*0.9),
                         'Kcb_mid_plus_10pct':replace(cp,kcb_mid=cp.kcb_mid*1.1),
                         'without_soil_assimilation':replace(cp,assimilate_observations=False)}
            for name, sp in scenarios.items():
                sd = modeled if name == 'baseline' else simulate(d,planting,sp)
                sd = sd.loc[sd.Date >= pd.Timestamp(planting)].copy()
                sl = leaching_intervals(sd,basis,cfg['concentration_method'])
                sensitivities.append(dict(meta, Scenario=name, ETa_mm=float(sd.ETa_model_mm.sum()),
                                           Drainage_mm=float(sd.Drainage_mm.sum()),
                                           Load_kg_ha=total_or_missing(sl,'Load_reported_analyte_kg_ha')))
    daily = pd.concat(daily_all,ignore_index=True)
    wb = pd.concat(wb_all,ignore_index=True) if wb_all else pd.DataFrame()
    loads = pd.concat(load_all,ignore_index=True) if load_all else pd.DataFrame()
    summary = pd.DataFrame(summaries)
    plot_year = plot_year_table(summary)
    checks = scientific_checks(daily,wb,loads)
    comparison = pd.DataFrame(comparisons)
    sensitivity = pd.DataFrame(sensitivities)
    metrics = ['ETa_model_mm','ETa_Actual_mm','ETa_WB_covered_mm','Drainage_mm','Load_reported_analyte_kg_ha']
    treatment = summary.groupby(['Dataset','Site','Year','Irrigation_treatment','Nitrogen_treatment'])[metrics].agg(['count','mean','std'])
    treatment.columns = ['_'.join(c) for c in treatment.columns]
    treatment = treatment.reset_index()
    coverage = summary.groupby(['Dataset','Site','Year'],as_index=False).agg(
        Plots=('Plot','count'), Plots_with_nitrate=('Leaching_intervals',lambda s:int((s>0).sum())),
        Plots_with_WB=('WB_intervals',lambda s:int((s>0).sum())),
        Observed_profiles=('Observed_profiles','sum'), Nitrate_dates=('Nitrate_dates','sum'))
    figure_index = draw_plot_year_figures(plot_year,output,pd.DataFrame(dataset_status))
    tables = dict(plot_year_results=plot_year, result_column_definitions=result_dictionary(),
                  figure_index=figure_index,
                  plot_summary=summary, water_balance_intervals=wb, leaching_intervals=loads,
                  concentration_method_comparison=comparison, sensitivity=sensitivity,
                  coverage=coverage, validation=checks, data_quality=pd.DataFrame(src.issues),
                  dataset_status=pd.DataFrame(dataset_status), treatment_summary=treatment,
                  workbook_validation=workbook_checks, workbook_issues=workbook_issues,
                  nitrate_lab_audit=src.nitrate_audit, nitrate_samples=src.nitrate_samples)
    tables['irrigation_audit'] = src.irrigation_audit
    tables['moisture_audit'] = src.moisture_audit
    for name, table in tables.items():
        tmp = output/(name+'.csv.tmp')
        table.to_csv(tmp,index=False)
        tmp.replace(output/(name+'.csv'))
    daily.to_csv(output/'daily_water_balance.csv.gz', index=False, compression='gzip')
    tmp_xlsx = output/'results.tmp.xlsx'
    with pd.ExcelWriter(tmp_xlsx,engine='openpyxl') as writer:
        for name,table in tables.items():
            if name not in ['nitrate_lab_audit','nitrate_samples']:
                table.to_excel(writer,sheet_name=name[:31],index=False)
    tmp_xlsx.replace(output/'results.xlsx')
    unique = {entry['path']:entry for entry in src.manifest}
    for path,entry in unique.items():
        entry['sha256'] = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    manifest = dict(config=cfg, parameters=parameters_dict(p), inputs=list(unique.values()),
                    implementation={f:hashlib.sha256((PROJECT/f).read_bytes()).hexdigest() for f in
                        ['leaching_model.py','leaching_sources.py','leaching_pipeline.py','leaching_results.py','workbook_validation.py']},
                    software=dict(python=platform.python_version(),numpy=np.__version__,pandas=pd.__version__,matplotlib=matplotlib.__version__),
                    daily_rows=len(daily),plots=len(summary),validation_passed=bool(checks.Passed.all()),
                    dataset_status=dataset_status,
                    result_status='provisional: soil parameters, nitrate mg/L basis and lab-date proxy need confirmation')
    (output/'run_manifest.json').write_text(json.dumps(manifest,indent=2,default=str)+'\n')
    draw_figures(daily,summary,output)
    progress(f'Finished: {len(summary)} plots, {len(daily):,} daily rows, {len(wb):,} WB intervals, {len(loads):,} leaching intervals. All numerical checks passed.')
    return dict(daily=daily, summary=summary, water_balance=wb, leaching=loads,
                plot_year=plot_year, figure_index=figure_index,
                coverage=coverage, checks=checks, data_quality=tables['data_quality'],
                sensitivity=sensitivity, concentration_comparison=comparison, output_dir=output,
                workbook_checks=workbook_checks, workbook_issues=workbook_issues,
                dataset_status=pd.DataFrame(dataset_status), treatment_summary=treatment,
                nitrate_lab_audit=src.nitrate_audit)


def draw_figures(daily,summary,output):
    plt.rcParams.update({'font.size':10,'axes.spines.top':False,'axes.spines.right':False,'figure.dpi':120})
    groups = list(summary.groupby(['Site','Year'],sort=True))
    fig, axes = plt.subplots(len(groups),3,figsize=(13,3*len(groups)),squeeze=False,constrained_layout=True)
    for row,((site,year),s) in enumerate(groups):
        for col,(metric,title) in enumerate([('ETa_model_mm','Modeled ETa (mm)'),('Drainage_mm','Modeled drainage (mm)'),('Load_reported_analyte_kg_ha','Sample-covered load (reported analyte, kg/ha)')]):
            for i,(trt,g) in enumerate(s.groupby('Irrigation_treatment',sort=True)):
                values = g[metric].dropna()
                axes[row,col].scatter(np.full(len(values),i)+np.linspace(-0.15,0.15,len(values)),values,alpha=0.5,s=14)
                if len(values):
                    axes[row,col].plot([i-0.2,i+0.2],[values.median()]*2,color='black',lw=2)
            axes[row,col].set_xticks(range(s.Irrigation_treatment.nunique()))
            axes[row,col].set_xticklabels(sorted(s.Irrigation_treatment.unique()))
            axes[row,col].set_title(f'{site} {year}: {title}')
            axes[row,col].grid(axis='y',alpha=0.2)
    fig.suptitle('Provisional raw-input results · dots = plots; black lines = medians',fontsize=13)
    fig.savefig(output/'treatment_results.png',bbox_inches='tight')
    fig.savefig(output/'treatment_results.pdf',bbox_inches='tight')
    plt.close(fig)
    selected = summary.sort_values(['Observed_profiles','Nitrate_dates'],ascending=False).iloc[0]
    d = daily.loc[(daily.Site==selected.Site)&(daily.Year==selected.Year)&(daily.Plot==selected.Plot)]
    fig,ax = plt.subplots(3,1,figsize=(12,9),sharex=True,constrained_layout=True)
    ax[0].bar(d.Date,d.Rain_mm,label='Rain',color='#72add1')
    ax[0].bar(d.Date,d.Irrigation_mm,bottom=d.Rain_mm,label='Irrigation',color='#155a88')
    ax[0].plot(d.Date,d.ETa_model_mm,label='Modeled ETa',color='#b65323');ax[0].set_ylabel('Water (mm/day)');ax[0].legend(ncol=3)
    ax[1].plot(d.Date,d.Storage_end_mm,label='Modeled/assimilated storage',color='#145a53')
    ax[1].scatter(d.Date,d.Observed_storage_mm,label='Complete PR2 profiles',color='black',s=15)
    ax[1].set_ylabel('Profile storage (mm)');ax[1].legend()
    ax[2].bar(d.Date,d.Drainage_mm,color='#636bb1',label='Modeled drainage')
    ax[2].set_ylabel('Drainage (mm/day)')
    second=ax[2].twinx();second.scatter(d.Date,d.Nitrate_mg_L,color='#b65323',s=16,label='Nitrate (lab-date proxy)');second.set_ylabel('Reported concentration (assumed mg/L)')
    fig.suptitle(f'{selected.Site} {selected.Year}, plot {selected.Plot} · provisional daily budget')
    fig.savefig(output/'daily_example.png',bbox_inches='tight');fig.savefig(output/'daily_example.pdf',bbox_inches='tight');plt.close(fig)


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw-root',default=str(DEFAULT_RAW))
    parser.add_argument('--output-dir',default=str(PROJECT/'outputs_raw'))
    parser.add_argument('--config',help='JSON configuration overrides')
    args=parser.parse_args()
    cfg=json.loads(Path(args.config).read_text()) if args.config else {}
    cfg.update(raw_root=args.raw_root,output_dir=args.output_dir)
    run(cfg)
