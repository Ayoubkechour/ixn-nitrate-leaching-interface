"""Refresh unchanged engine copies and synthetic input templates."""
from pathlib import Path
import shutil
import json
import hashlib
import pandas as pd
import numpy as np

HERE=Path(__file__).resolve().parent
OUT=HERE/'dist'/'templates'
OUT.mkdir(parents=True,exist_ok=True)
hashes={}
for name in ['leaching_model.py','leaching_sources.py','leaching_pipeline.py','leaching_results.py','workbook_validation.py']:
    source=HERE.parent/name
    shutil.copyfile(source,HERE/'dist'/'python'/name)
    hashes[name]=hashlib.sha256(source.read_bytes()).hexdigest()
(HERE/'dist'/'engine_provenance.json').write_text(json.dumps(dict(source='IXN_nitrate_leaching',sha256=hashes),indent=2))
dates=pd.date_range('2022-04-01','2022-08-31')
t=np.arange(len(dates))
weather=pd.DataFrame(dict(Date=dates.strftime('%Y-%m-%d'),Tmax_C=np.round(22+8*np.sin(t/65),2),Tmin_C=np.round(10+6*np.sin(t/65),2),Wind_m_s=np.round(2.5+.5*np.cos(t/8),2),Rs_MJ_m2_day=np.round(18+5*np.sin(t/60),2),Rain_mm=np.where(t%9==0,23.,0.),Tdew_C=np.round(7+4*np.sin(t/65),2)))
irrigation=pd.DataFrame([dict(Date=date,Plot=plot,Irrigation_mm=amount) for plot,amount in [(101,15),(102,22),(103,30)] for date in ['2022-06-01','2022-06-20','2022-07-10','2022-07-30','2022-08-15']])
nitrate=pd.DataFrame([dict(Date=date,Plot=plot,Nitrate_mg_L=value) for plot,value in [(101,5.5),(102,11.2),(103,18.4)] for date in ['2022-05-20','2022-06-10','2022-07-01','2022-07-22','2022-08-15','2022-08-30']])
moisture_dates=['2022-05-20','2022-06-10','2022-07-01','2022-07-22','2022-08-15','2022-08-30']
pr2_cols=['6in_VWC %','12in_VWC %','18in_VWC %','24_inVWC %','36in_VWC %']
moisture=pd.DataFrame([
    dict(Date=date,Plot=plot,**{column:round(value+plot_shift+date_shift,2)
        for column,value in zip(pr2_cols,[17.0,15.5,13.5,11.5,9.0])})
    for plot,plot_shift in [(101,0.0),(102,0.8),(103,1.6)]
    for date,date_shift in zip(moisture_dates,[0.0,0.6,-0.5,0.9,-0.3,0.4])
])
plots=pd.DataFrame([dict(Plot=plot,Irrigation_treatment=f'I{i+1}',Nitrogen_treatment=f'N{i+1}',Rep=1) for i,plot in enumerate([101,102,103])])
tables=dict(weather=weather,irrigation=irrigation,nitrate=nitrate,moisture=moisture,plots=plots)
for name,table in tables.items():table.to_csv(OUT/('example_'+name+'.csv'),index=False)
with pd.ExcelWriter(OUT/'input_template.xlsx',engine='openpyxl') as writer:
    for name,table in tables.items():table.to_excel(writer,sheet_name=name.capitalize(),index=False)
    pd.DataFrame({'Read me':['SYNTHETIC EXAMPLE DATA — replace every observation with your own field data.','Weather: °C, m/s, MJ/m²/day, mm; use dew point OR RHmin_pct and RHmax_pct.','Nitrate: solution mg/L, not soil nitrate. Set analyte basis and date verification in the interface.','Moisture: raw PR2 VWC (%) at 6, 12, 18, 24 and 36 inches, matching Master_PR2_SM.xlsx.','Complete PR2 rows integrate to 0–0.9144 m storage. Missing depths remain missing.','Dates: YYYY-MM-DD. Resolve duplicate plot/date observations before upload.','Irrigation: complete event log; unlisted days are zero. Include a zero record for any plot without events.','Default parameters are retained IXN values; review their applicability to your site.']}).to_excel(writer,sheet_name='Instructions',index=False)
(OUT/'input_guide.txt').write_text('''IXN NITRATE & WATER BALANCE — INPUT GUIDE

Use separate CSV/XLSX tables or one XLSX with Weather, Irrigation, Nitrate,
Moisture and Plots sheets. Individual uploads override the matching workbook sheet.
The downloadable workbook contains SYNTHETIC examples, not field measurements.

Required weather columns:
Date,Tmax_C,Tmin_C,Wind_m_s,Rs_MJ_m2_day,Rain_mm,Tdew_C
Instead of Tdew_C you may provide RHmin_pct,RHmax_pct. Paired RH takes priority.
Units: Celsius, m/s, MJ/m2/day, mm/day. One unique consecutive date per day.
Cover planting through analysis end and include preplant history. The original
raw workflow starts April 1; the supplied weather start initializes the prepared
tables calculation. Missing weather is an error, never zero-filled.

Required irrigation columns: Date,Plot,Irrigation_mm
One unique record per date/plot; this must be a complete event log. Days without
a record are zero. Include an explicit zero record for a non-irrigated plot.
Blank logged amounts cause an error unless the flagged zero scenario is selected.

Optional nitrate columns: Date,Plot,Nitrate_mg_L
Measured solution concentration only. Select source units and analyte basis.
The column name remains Nitrate_mg_L when source units are micrograms/L; the
interface converts that selection to mg/L. Valid zeros are retained; sentinels
999/9999 become missing. At least two valid in-season dates per plot are needed
for load. Load covers those intervals only, with no extrapolation.

Optional moisture columns: Date,Plot,6in_VWC %,12in_VWC %,18in_VWC %,24_inVWC %,36in_VWC %
These are raw PR2 volumetric water content percentages, as in the Westport sheet
of Master_PR2_SM.xlsx. The interface integrates complete rows with midpoint
cells over 0–0.9144 m. The standard model profile is matched to that depth;
no water is extrapolated to 1.2 m. Missing depths remain missing and are not
used for assimilation or measured water-balance intervals. The input audit
preserves every raw depth reading. Alternatively supply Date,Plot,
Observed_storage_mm for full-profile end-of-day storage in mm at the model depth.
Without paired complete profiles, WB_ETa uses labeled modeled fallback.

Optional plot map columns: Plot,Irrigation_treatment,Nitrogen_treatment,Rep
Plot and Rep are whole numbers. Use any treatment labels. Without a map,
treatments remain Unspecified and Rep=0. With a map, every observed plot must
have an entry; mapped non-irrigated plots may have no events.

Raw IXN mode uses the original Raw_data_NNI structure: Weather_data CSV files,
Master_fielddata/Master_Irrigation.xlsx, Master_PR2_SM.xlsx and
Nitrate_Concentrations_RAW_Lab.xlsx, plus Site/Year/Experimental_protocol/*.xlsx.
Collection calendar (optional CSV): Site,Year,Week,Collection_date.
Date/plot-map overrides: JSON as shown in raw_config_example.json. Plot-map
paths are relative to the selected folder; put uploaded maps in plot_maps/.
Westport 2023 stays excluded without a verified map. Becker 2024 needs a
verified planting-date override. The one-plot reference workbook is not raw data.

Outputs: plot-year workbook and CSVs; interval water balance and leaching;
daily CSV.gz; treatment summaries; quality/validation tables; figures in
PDF/PNG; a run manifest with input hashes, model settings and software versions.
Numerical agreement verifies implementation, not field prediction accuracy.
''')
(OUT/'raw_config_example.json').write_text(json.dumps(dict(planting_overrides={'Becker-2024':'REPLACE_WITH_VERIFIED_YYYY-MM-DD'},end_overrides={},plot_plan_overrides={'Westport-2023':'plot_maps/Westport_2023.csv'}),indent=2))
print('Engine sources synchronized; synthetic templates generated.')
