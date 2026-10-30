"""Read field inputs without altering originals or trusting stale workbook labels."""
from pathlib import Path
import re
import numpy as np
import pandas as pd
from leaching_model import reference_et, Parameters

PLANTING = {
    'Becker': {2021:'2021-05-07', 2022:'2022-05-16', 2023:'2023-05-24', 2024:'2024-05-10'},
    'Westport': {2021:'2021-05-18', 2022:'2022-05-23', 2023:'2023-05-11', 2024:'2024-05-24'},
}


class UnverifiedPlotPlan(ValueError):
    """A protocol cannot safely assign treatments to this year's samples."""


class Sources:
    def __init__(self, root, project):
        self.root = Path(root).resolve()
        self.project = Path(project).resolve()
        self.manifest = []
        self.issues = []

    def record(self, path, role, **kwargs):
        path = Path(path)
        if not path.is_file():
            raise FileNotFoundError('Missing '+role+': '+str(path))
        self.manifest.append(dict(path=str(path.resolve()), role=role,
                                  bytes=path.stat().st_size, **kwargs))

    def issue(self, scope, message, severity='review'):
        self.issues.append(dict(scope=scope, severity=severity, message=message))

    def weather(self, site, year, planting, end, p):
        path = self.root/'Weather_data'/f'{site}_weather_Data_2020_2024.csv'
        self.record(path, 'raw NDAWN weather', Site=site, Year=year)
        with path.open() as f:
            header = next((i for i, line in enumerate(f) if 'Max Temp' in line and 'Year' in line), None)
        if header is None:
            raise ValueError('Cannot locate named NDAWN header: '+str(path))
        d = pd.read_csv(path, skiprows=header)
        date = pd.to_datetime(d[['Year','Month','Day']].apply(pd.to_numeric, errors='coerce'), errors='coerce')
        d['Date'] = date
        d = d.loc[date.between(min(pd.Timestamp(f'{year}-04-01'), pd.Timestamp(planting)), pd.Timestamp(end))].copy()
        names = {'Max Temp':'Tmax_C','Min Temp':'Tmin_C','Avg Wind Speed':'Wind_m_s',
                 'Total Solar Rad':'Rs_MJ_m2_day','Rainfall':'Rain_mm','Dew Point':'Tdew_C'}
        for old, new in names.items():
            d[new] = pd.to_numeric(d[old], errors='raise')
        complete = d[list(names.values())].notna().all(axis=1)
        for flag in [c+' Flag' for c in names if c+' Flag' in d]:
            complete &= ~d[flag].fillna('').astype(str).str.strip().isin(['M','N/A'])
            if d[flag].fillna('').astype(str).str.strip().eq('E').any():
                self.issue(f'{site}-{year}', 'Estimated weather values present in '+flag)
        if not complete.all():
            missing_dates = d.loc[~complete,'Date']
            if not complete.any() or d.loc[complete,'Date'].max() >= missing_dates.min():
                raise ValueError('Interior missing weather values; supply verified data for '+str(missing_dates.tolist()))
            self.issue(f'{site}-{year}', f'Trailing missing weather days {missing_dates.min().date()} through {missing_dates.max().date()} excluded. Effective model end is {d.loc[complete,"Date"].max().date()}, not requested harvest/cutoff; no missing rain is filled zero.')
            d = d.loc[complete].copy()
        lat = pd.to_numeric(d.Latitude, errors='raise').unique()
        elev = pd.to_numeric(d.Elevation, errors='raise').unique()
        if len(lat) != 1 or len(elev) != 1:
            raise ValueError('Mixed station coordinates in '+str(path))
        self.issue(f'{site}-{year}', f'Use station metadata: latitude {lat[0]} degrees, elevation {elev[0]} ft converted to m; wind height 3 m from original notebooks. Confirm wind-height metadata.')
        return reference_et(d[['Date']+list(names.values())], float(lat[0]), float(elev[0])*0.3048, albedo=p.albedo)

    def irrigation(self, blank_policy='flag_zero'):
        path = self.root/'Master_fielddata'/'Master_Irrigation.xlsx'
        self.record(path, 'raw master irrigation, inches')
        d = pd.read_excel(path).rename(columns={'location':'Site','Location':'Site','Irrigation':'Irrigation_treatment','Irrigation_Amount_in':'Amount_in'})
        d['Date'] = pd.to_datetime(d.Date, errors='raise').dt.normalize()
        d['Amount_in'] = pd.to_numeric(d.Amount_in, errors='raise')
        if (d.Amount_in < 0).any():
            raise ValueError('Negative irrigation records.')
        d['Irrigation_observed_mm'] = d.Amount_in*25.4
        d['Blank_irrigation_imputed'] = d.Amount_in.isna()
        if d.Blank_irrigation_imputed.any():
            if blank_policy == 'error':
                raise ValueError('Blank logged irrigation amounts; inspect irrigation audit or select the explicit flag_zero compatibility scenario.')
            if blank_policy != 'flag_zero':
                raise ValueError('blank_irrigation_policy must be error or flag_zero.')
            self.issue('blank irrigation', f'{d.Blank_irrigation_imputed.sum()} blank logged amounts retained in Irrigation_observed_mm. Model uses the original zero-fill compatibility scenario, flagged per day/plot and in interval/summary counts. These are conditional estimates, not verified irrigation totals.')
        d['Amount_in'] = d.Amount_in.fillna(0)
        key = ['Site','Date','Irrigation_treatment']
        if d.duplicated(key).any():
            raise ValueError('Ambiguous duplicate irrigation events; resolve before daily aggregation.')
        d['Irrigation_mm'] = d.Amount_in*25.4
        d['Year'] = d.Date.dt.year
        self.irrigation_audit = d.copy()
        self.issue('raw irrigation', 'Master_fielddata/Master_Irrigation.xlsx is the selected source. The reference/irrigation version differs; it is not merged or substituted. Verify that recorded dates cover the entire season.')
        return d

    def plot_plan(self, site, year, override=None):
        if override:
            path = Path(override)
            self.record(path,'explicit current-year plot treatment override',Site=site,Year=year)
            d = pd.read_csv(path) if path.suffix.lower() == '.csv' else pd.read_excel(path)
            required = ['Plot','Irrigation_treatment','Nitrogen_treatment']
            if not set(required) <= set(d.columns) or d[required].isna().any().any():
                raise ValueError('Plot-plan override needs complete '+','.join(required))
            d['Plot'] = pd.to_numeric(d.Plot,errors='raise').astype(int)
            if d.Plot.duplicated().any() or not d.Irrigation_treatment.str.fullmatch('I[1-4]').all() or not d.Nitrogen_treatment.str.fullmatch('N[1-6]').all():
                raise ValueError('Duplicate plots or invalid I1–I4/N1–N6 in plot-plan override.')
            if 'Rep' not in d:
                d['Rep'] = d.Plot//100
            return d[required+['Rep']].sort_values('Plot').reset_index(drop=True)
        if site == 'Westport' and year == 2023:
            # The field owner confirmed the unchanged layout in this session.
            # A supplied current-year override above still takes precedence.
            plan = self.plot_plan('Westport', 2022).copy()
            source = self.manifest[-1]['path']
            confirmation = 'User confirmed on 2026-10-30 that Westport 2023 uses the same plot IDs, irrigation treatments, nitrogen treatments and replicates as 2022.'
            self.record(source, 'user-confirmed Westport 2022 treatment map reused for 2023',
                        Site=site, Year=year, Source_year=2022,
                        Confirmation_date='2026-10-30', Confirmation=confirmation)
            self.issue('Westport-2023', confirmation + ' The incompatible supplied 2023 protocol is not used; weather, irrigation, moisture and nitrate remain from 2023.', severity='provenance')
            plan.attrs['provenance'] = confirmation
            return plan
        folder = self.root/site/str(year)/'Experimental_protocol'
        files = sorted(folder.glob('*.xlsx'))
        if len(files) != 1:
            raise ValueError('Expected one protocol workbook in '+str(folder))
        path = files[0]
        self.record(path, 'raw plot treatment protocol', Site=site, Year=year)
        with pd.ExcelFile(path) as x:
            grids = [s for s in x.sheet_names if 'plot plan' in s.lower()]
            records = {}
            incompatible = []
            for sn in grids:
                d = pd.read_excel(x, sheet_name=sn, header=None)
                for i in range(len(d)-1):
                    for j in range(d.shape[1]):
                        value, trt = d.iat[i,j], str(d.iat[i+1,j])
                        match = re.fullmatch(r'\s*(I[1-4])\s+(N[1-6])\s*', trt)
                        try:
                            plot = int(float(value))
                        except (TypeError, ValueError, OverflowError):
                            continue
                        if match and plot >= 100:
                            if plot > 499:
                                incompatible.append(plot)
                                continue
                            record = (match[1], match[2])
                            if plot in records and records[plot] != record:
                                raise ValueError('Conflicting plot plans for '+str(plot))
                            records[plot] = record
            if incompatible:
                raise UnverifiedPlotPlan(f'{site}-{year} protocol uses incompatible plot IDs (e.g. {incompatible[:6]}), while measured IDs use 101–424. No numbering crosswalk is supplied; even the apparent 101–404 matches cannot be trusted. Supply a current-year plot_plan_overrides table.')
            if not records:
                raise ValueError('No plot treatments found in '+str(path))
            # Compare against plant label table only when its embedded year is correct.
            if 'Plant and soil bag labels' in x.sheet_names:
                labels = pd.read_excel(x, sheet_name='Plant and soil bag labels', header=1)
                if {'Year','Plot#','Irrigation','N rate'} <= set(labels.columns):
                    yrs = pd.to_numeric(labels.Year, errors='coerce').dropna().unique()
                    if len(yrs) != 1 or int(yrs[0]) != year:
                        raise UnverifiedPlotPlan(f'{site}-{year} protocol label year is {list(yrs)}; current-year treatment assignments are unverified. Supply plot_plan_overrides.')
                    else:
                        for row in labels[['Plot#','Irrigation','N rate']].drop_duplicates().itertuples(index=False, name=None):
                            try:
                                plot = int(row[0])
                            except (ValueError, TypeError):
                                continue
                            if plot in records and records[plot] != tuple(row[1:]):
                                raise ValueError(f'Plot Plan/label conflict {site} {year} plot {plot}')
            return pd.DataFrame([dict(Plot=k, Irrigation_treatment=v[0], Nitrogen_treatment=v[1], Rep=k//100) for k,v in sorted(records.items())])

    def moisture(self):
        path = self.root/'Master_fielddata'/'Master_PR2_SM.xlsx'
        self.record(path, 'raw PR2 volumetric moisture, percent')
        d = pd.read_excel(path, sheet_name='Westport')
        d['Date'] = pd.to_datetime(d.Date, errors='raise').dt.normalize()
        d['Plot'] = pd.to_numeric(d.Plot, errors='raise').astype(int)
        cols = ['6in_VWC %','12in_VWC %','18in_VWC %','24_inVWC %','36in_VWC %']
        self.moisture_audit = d.copy()
        d[cols] = d[cols].apply(pd.to_numeric, errors='raise')/100
        invalid = (d[cols] < 0) | (d[cols] > 1)
        self.moisture_audit['Invalid_VWC_count'] = invalid.sum(axis=1)
        if invalid.any().any():
            self.issue('invalid PR2', f'{int(invalid.sum().sum())} VWC readings outside physical [0,100]% are flagged in moisture_audit.csv and set missing; affected complete profiles are excluded.')
            d[cols] = d[cols].mask(invalid)
        if d.duplicated(['Plot','Date']).any():
            raise ValueError('Duplicate PR2 plot/date observations require resolution.')
        # Explicit nearest-neighbour cells from 0 to deepest sensor; no 1.2-m extrapolation.
        centers = np.array([6,12,18,24,36])*0.0254
        edges = np.r_[0, (centers[:-1]+centers[1:])/2, centers[-1]]
        weights = np.diff(edges)*1000
        d['Observed_storage_mm'] = d[cols].mul(weights, axis=1).sum(axis=1, min_count=len(cols))
        d['Complete_profile'] = d[cols].notna().all(axis=1)
        self.issue('PR2 geometry', 'PR2 integration uses midpoint cells over 0–0.9144 m, with thicknesses '+str(weights.tolist())+' mm. Partial profiles remain missing. Geometry is explicit and should be reviewed against sensor installation; no interpolation to 1.2 m.')
        self.issue('PR2 missing profiles', f'{(~d.Complete_profile).sum()} of {len(d)} observed profiles are incomplete and excluded from storage assimilation/WB intervals.')
        return d

    def nitrate(self, collection_calendar=None):
        path = self.root/'Master_fielddata'/'Nitrate_Concentrations_RAW_Lab.xlsx'
        self.record(path, 'raw laboratory solution nitrate; units and collection dates unverified')
        d = pd.read_excel(path, sheet_name='Nitrate_Concentrations')
        d['Lab_row'] = np.arange(len(d))+2
        key = d['Primary Key'].astype(str).str.strip().str.lstrip('\\').str.upper()
        parsed = key.str.extract(r'^IN(?P<yy>\d{2})(?P<code>WP|B|R|W)(?P<Week>\d+)(?P<Position>[EW])(?P<Plot>\d{3})$')
        d = d.join(parsed)
        d['Parse_valid'] = d.yy.notna()
        d['Nitrate_numeric'] = pd.to_numeric(d.Nitrate, errors='coerce')
        d['Legacy_65p75_threshold_exceeded'] = d.Nitrate_numeric.gt(65.75) & ~d.Nitrate_numeric.isin([999,9999])
        d['Nitrate_status'] = np.select([~d.Parse_valid, d.Nitrate_numeric.isin([999,9999]),
                                        d.Nitrate_numeric.isna(), d.Nitrate_numeric < 0],
                                       ['unmatched_identifier','sentinel_missing','nonnumeric_or_missing','negative'], default='valid')
        self.nitrate_audit = d.copy()
        q = d.loc[d.Parse_valid].copy()
        q['Site'] = q.code.map({'B':'Becker','WP':'Westport','R':'Westport','W':'Westport'})
        q['Year'] = 2000+q.yy.astype(int)
        q[['Plot','Week']] = q[['Plot','Week']].astype(int)
        q['Date'] = pd.to_datetime(q['Date Modified'], errors='raise').dt.normalize()
        if (q.Date.dt.year != q.Year).any():
            raise ValueError('Lab dates do not match sample ID year.')
        q['Date_source'] = 'lab_modified_proxy'
        if collection_calendar is not None:
            calendar = pd.read_csv(collection_calendar)
            calendar['Collection_date'] = pd.to_datetime(calendar.Collection_date, errors='raise').dt.normalize()
            q = q.merge(calendar[['Site','Year','Week','Collection_date']], on=['Site','Year','Week'], how='left', validate='many_to_one')
            if q.Collection_date.isna().any():
                raise ValueError('Collection calendar must cover every parsed sample week.')
            q['Date'] = q.Collection_date
            q['Date_source'] = 'verified_collection_calendar'
            self.record(collection_calendar, 'verified nitrate collection calendar')
        else:
            self.issue('nitrate dates', 'Date Modified is a LAB date, not a verified collection date. Default retains original notebook proxy. Leaching is provisional; provide Site/Year/Week/Collection_date calendar for defensible sampling intervals.')
        q['Repeated_sample_identity'] = q.duplicated(['Site','Year','Week','Position','Plot'], keep=False)
        if q.Repeated_sample_identity.any():
            self.issue('repeated lab identity', f'{q.Repeated_sample_identity.sum()} rows share normalized sample identity. Original rows retained; averages are within position/date and date provenance remains provisional.')
        q['Nitrate_mg_L'] = q.Nitrate_numeric.where(q.Nitrate_status.eq('valid'))
        self.issue('nitrate identity', f'{len(d)-len(q)} lab rows excluded as standards/other formats/unmatched identifiers; all original rows and reasons retained in nitrate_lab_audit.csv.')
        self.issue('nitrate sentinels', f'{q.Nitrate_status.eq("sentinel_missing").sum()} sentinels (999/9999) kept missing; zero concentrations retained. No IQR filtering.')
        self.issue('nitrate units', 'Raw workbook has no concentration units or NO3 versus NO3-N basis. mg/L is an explicit compatibility assumption; nitrogen load is left missing unless basis is confirmed in config. Reported-analyte load remains provisional.')
        self.issue('65.75 comment', 'VRN_VRI_becker.ipynb cell 152 zeroes Nitrate >65.75. Valid high measurements are flagged and retained in primary analysis. A separate legacy-zero comparison reports its effect; comment authorship is not marked in the notebook.')
        self.nitrate_samples = q.copy()
        # Average analytical observations within a position, then equal-weight positions.
        positions = q.groupby(['Site','Year','Plot','Date','Position'], as_index=False).agg(
            Nitrate_mg_L=('Nitrate_mg_L','mean'), Valid_lab_samples=('Nitrate_mg_L','count'))
        daily = positions.groupby(['Site','Year','Plot','Date'], as_index=False).agg(
            Nitrate_mg_L=('Nitrate_mg_L','mean'), Valid_positions=('Nitrate_mg_L','count'),
            Valid_lab_samples=('Valid_lab_samples','sum'))
        return daily



def standardized_dataset(folder, p, metadata, planting_date, end_date, latitude_deg, elevation_m,
                         wind_height_m=3.0):
    """Adapter for IXN or VRI/VRN: weather.csv, irrigation.csv, optional moisture.csv/nitrate.csv.

    Unique Date weather, Date/Plot irrigation; moisture is Observed_storage_mm
    at the same profile depth as Parameters. Nitrate is measured mg/L, not soil N.
    """
    folder = Path(folder)
    weather = reference_et(pd.read_csv(folder/'weather.csv'), latitude_deg, elevation_m, wind_height_m, p.albedo)
    irr = pd.read_csv(folder/'irrigation.csv')
    irr['Date'] = pd.to_datetime(irr.Date).dt.normalize()
    if irr.duplicated(['Date','Plot']).any():
        raise ValueError('Duplicate custom irrigation plot/date records.')
    datasets = []
    for plot in sorted(irr.Plot.unique()):
        d = weather.loc[weather.Date.between(pd.Timestamp(planting_date)-pd.Timedelta(days=5), pd.Timestamp(end_date))].copy()
        di = irr.loc[irr.Plot == plot, ['Date','Irrigation_mm']]
        d = d.merge(di, on='Date', how='left', validate='one_to_one')
        d['Irrigation_mm'] = d.Irrigation_mm.fillna(0)
        for filename, col in [('moisture.csv','Observed_storage_mm'), ('nitrate.csv','Nitrate_mg_L')]:
            path = folder/filename
            if path.exists():
                obs = pd.read_csv(path)
                obs['Date'] = pd.to_datetime(obs.Date).dt.normalize()
                obs = obs.loc[obs.Plot == plot, ['Date',col]]
                d = d.merge(obs, on='Date', how='left', validate='one_to_one')
        datasets.append((dict(metadata, Plot=int(plot)), d, planting_date, p))
    return datasets
