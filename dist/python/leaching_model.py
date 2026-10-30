"""Auditable IXN notebook/spreadsheet equations (mm, mg/L).

The ET, evaporation, previous-day depletion, stress and deep-percolation
sequence follows IxN.ipynb and the user-provided 113 reference spreadsheet.
Observation resets are recorded as a separate water-budget term.
"""
from dataclasses import dataclass, asdict
import numpy as np
import pandas as pd

KG_HA_TO_LB_AC = 0.892179121619


@dataclass
class Parameters:
    # Values retained from BOTH original notebooks; see supervisor_notes.md.
    stage_days: tuple = (30, 50, 50, 37)
    kcb_initial: float = 0.15
    kcb_mid: float = 1.15
    kcb_end: float = 0.15
    height_max_m: float = 3.60
    climate_adjustment_height_m: float = 2.5
    root_min_m: float = 0.10
    root_max_m: float = 1.20
    mad: tuple = (0.60, 0.45, 0.45, 0.60)
    tew_mm: float = 12.75
    rew_mm: float = 10.0
    surface_depletion_initial_mm: float = 0.0
    profile_depletion_initial_mm: float = 0.0
    wetted_fraction: float = 1.0
    cn: tuple = (46.02, 67.0, 83.41)
    antecedent_threshold_mm: tuple = (36.0, 53.0)
    albedo: float = 0.23
    kcmax_wind_factor: float = 0.9
    assimilate_observations: bool = True
    # Standard source soil layers, upper boundary 0 m; FC/WP are fractions.
    soil_bottom_m: tuple = (0.30, 0.60, 0.90, 1.20)
    soil_fc: tuple = (0.16, 0.151, 0.112, 0.053)
    soil_wp: tuple = (0.065, 0.057, 0.036, 0.009)

    def validate(self):
        b, fc, wp = map(np.asarray, (self.soil_bottom_m, self.soil_fc, self.soil_wp))
        if not (len(b) == len(fc) == len(wp) and np.all(np.diff(np.r_[0, b]) > 0)):
            raise ValueError('Soil layer boundaries must increase, with one FC/WP per layer.')
        if not np.all((wp >= 0) & (fc > wp) & (fc < 1)):
            raise ValueError('Require 0 <= WP < FC < 1, in m3/m3.')
        if not (0 <= self.profile_depletion_initial_mm <= self.capacity(b[-1], True)):
            raise ValueError('Initial profile depletion must lie in [0, profile TAW].')
        if not (0 <= self.rew_mm < self.tew_mm and 0 < self.wetted_fraction <= 1):
            raise ValueError('Require REW < TEW and 0 < wetted fraction <= 1.')
        if not (0 <= self.surface_depletion_initial_mm <= self.tew_mm):
            raise ValueError('Initial surface depletion must lie in [0, TEW].')
        if len(self.stage_days) != 4 or min(self.stage_days) <= 0 or len(self.mad) != 4 or not all(0 < v < 1 for v in self.mad):
            raise ValueError('Four positive stage durations and four MAD fractions required.')
        if not (0 < self.root_min_m <= self.root_max_m and 0 <= self.albedo < 1):
            raise ValueError('Invalid root limits or albedo.')
        if not all(0 < v <= 100 for v in self.cn):
            raise ValueError('Curve numbers must lie in (0,100].')

    def capacity(self, depth_m, available=False):
        bottom = np.asarray(self.soil_bottom_m)
        top = np.r_[0, bottom[:-1]]
        thickness = np.maximum(np.minimum(depth_m, bottom) - top, 0)
        theta = np.asarray(self.soil_fc)
        if available:
            theta = theta - np.asarray(self.soil_wp)
        return float(np.sum(thickness * theta) * 1000)


def numeric_checked(df, columns, allow_missing=False):
    for col in columns:
        if col not in df:
            raise ValueError('Missing required column: ' + col)
        original = df[col]
        df[col] = pd.to_numeric(original, errors='coerce')
        if (original.notna() & df[col].isna()).any():
            raise ValueError('Nonnumeric values in ' + col)
        if np.isinf(df[col]).any() or (not allow_missing and df[col].isna().any()):
            raise ValueError('Missing or infinite values in ' + col)


def reference_et(weather, latitude_deg, elevation_m, wind_height_m=3.0, albedo=0.23,
                 julian_override=None):
    """IXN/workbook Penman-Monteith equations; explicit station units.

    Uses the temperature-dependent lambda/gamma in IXN and the workbook.
    """
    d = weather.copy()
    d['Date'] = pd.to_datetime(d['Date'], errors='raise').dt.normalize()
    required = ['Tmax_C', 'Tmin_C', 'Wind_m_s', 'Rs_MJ_m2_day', 'Rain_mm']
    numeric_checked(d, required)
    if not (-89 < latitude_deg < 89 and elevation_m >= -500 and wind_height_m > 0.1):
        raise ValueError('Invalid station coordinates or wind measurement height.')
    if d.Date.duplicated().any():
        raise ValueError('Weather must contain exactly one row per day.')
    if (d.Tmax_C < d.Tmin_C).any() or (d[['Wind_m_s', 'Rs_MJ_m2_day', 'Rain_mm']] < 0).any().any():
        raise ValueError('Invalid weather ranges.')
    sat = lambda t: 0.6108 * np.exp(17.27*t/(t+237.3))
    t = (d.Tmax_C + d.Tmin_C)/2
    es = (sat(d.Tmax_C) + sat(d.Tmin_C))/2
    if {'RHmax_pct', 'RHmin_pct'} <= set(d.columns):
        numeric_checked(d, ['RHmax_pct', 'RHmin_pct'])
        if ((d[['RHmax_pct', 'RHmin_pct']] < 0) | (d[['RHmax_pct', 'RHmin_pct']] > 100)).any().any() or (d.RHmin_pct > d.RHmax_pct).any():
            raise ValueError('Relative humidity must satisfy 0 <= RHmin <= RHmax <= 100.')
        ea = (sat(d.Tmin_C)*d.RHmax_pct/100 + sat(d.Tmax_C)*d.RHmin_pct/100)/2
        rhmin = d.RHmin_pct
    elif 'Tdew_C' in d:
        numeric_checked(d, ['Tdew_C'])
        ea = sat(d.Tdew_C)
        rhmin = (100*ea/sat(d.Tmax_C)).clip(0, 100)
    else:
        raise ValueError('Provide dew point or both RH extrema; humidity is never fabricated.')
    d['VPD_clipped'] = ea > es
    ea = np.minimum(ea, es)
    delta = 4098*sat(t)/(t+237.3)**2
    pressure = 101.3*((293-0.0065*elevation_m)/293)**5.26
    latent_heat = 2.501-0.002361*t
    gamma = 0.001013*pressure/(0.622*latent_heat)
    u2 = d.Wind_m_s*4.87/np.log(67.8*wind_height_m-5.42)
    j = d.Date.dt.dayofyear if julian_override is None else np.asarray(julian_override)
    lat = np.deg2rad(latitude_deg)
    dr = 1+0.033*np.cos(2*np.pi*j/365)
    decl = 0.409*np.sin(2*np.pi*j/365-1.39)
    ws = np.arccos(np.clip(-np.tan(lat)*np.tan(decl), -1, 1))
    ra = 24*60/np.pi*0.082*dr*(ws*np.sin(lat)*np.sin(decl)+np.cos(lat)*np.cos(decl)*np.sin(ws))
    rso = (0.75+0.00002*elevation_m)*ra
    ratio_raw = d.Rs_MJ_m2_day/rso
    ratio = ratio_raw
    rns = (1-albedo)*d.Rs_MJ_m2_day
    rnl = 4.903e-9*((d.Tmax_C+273.16)**4+(d.Tmin_C+273.16)**4)/2*(0.34-0.14*np.sqrt(ea))*(1.35*ratio-0.35)
    rn = rns-rnl
    for name, cn, cd in [('ETo_mm', 900, 0.34), ('ETr_mm', 1600, 0.38)]:
        et = (0.408*delta*rn+gamma*cn/(t+273)*u2*(es-ea))/(delta+gamma*(1+cd*u2))
        d[name+'_raw'] = et
        d[name] = et.clip(lower=0)
    d['RHmin_pct'] = rhmin
    d['Julian_day'] = j
    d['Lambda_MJ_kg'] = latent_heat
    d['Pressure_kPa'] = pressure
    d['Gamma_kPa_C'] = gamma
    d['Delta_kPa_C'] = delta
    d['U2_m_s'] = u2
    d['Ra_MJ_m2_day'] = ra
    d['Rso_MJ_m2_day'] = rso
    d['Rn_MJ_m2_day'] = rn
    d['Rns_MJ_m2_day'] = rns
    d['Rnl_MJ_m2_day'] = rnl
    d['ea_kPa'] = ea
    d['es_kPa'] = es
    d['Rs_Rso_outside_0p3_1'] = (ratio_raw < 0.3) | (ratio_raw > 1)
    return d.sort_values('Date').reset_index(drop=True)


def crop_coefficients(d, planting_date, p):
    d = d.copy()
    dap = (d.Date-pd.Timestamp(planting_date)).dt.days.to_numpy()
    limits = np.cumsum(p.stage_days)
    # Spreadsheet initial stage includes planting+Lini; subsequent phases
    # start the following day. This retains its Julian-boundary convention.
    stage = np.searchsorted(limits, dap, side='left').clip(0, 3)
    adjustment = 0.0
    mid = stage == 2
    # Equivalent to cumulative(end)-cumulative(start), excluding first day.
    climate = d.loc[(dap > limits[1]+1) & (dap <= limits[2])]
    if climate.empty:
        climate = d.loc[mid] if mid.any() else d
    adjustment = (0.04*(climate.U2_m_s.mean()-2)-0.004*(climate.RHmin_pct.mean()-45))*(p.climate_adjustment_height_m/3)**0.3
    kmid = p.kcb_mid + adjustment
    k = np.full(len(d), p.kcb_initial)
    dev = stage == 1
    k[dev] = p.kcb_initial+(kmid-p.kcb_initial)*(dap[dev]-limits[0]-1)/(p.stage_days[1]-1)
    k[mid] = kmid
    late = stage == 3
    k[late] = kmid+(p.kcb_end-kmid)*np.clip((dap[late]-limits[2]-1)/(p.stage_days[3]-1), 0, 1)
    growth = np.maximum.accumulate(np.clip((k-p.kcb_initial)/(kmid-p.kcb_initial), 0, 1))
    h = np.maximum.accumulate(np.maximum(k/kmid*p.height_max_m, 0.05))
    root = np.minimum(p.root_min_m+growth*(p.root_max_m-p.root_min_m), p.soil_bottom_m[-1])
    kcmax = np.maximum(1.2+(0.04*(d.U2_m_s*p.kcmax_wind_factor-2)-0.004*(d.RHmin_pct-45))*(h/3)**0.3, k+0.05)
    # Match the supplied spreadsheet's canopy expression and parentheses.
    # No replacement with an external crop-coefficient formulation.
    fc = np.clip((np.maximum(k-p.kcb_initial, 0)/(kcmax/p.kcb_initial))**(1+0.5*h), 0.01, 0.99)
    d['DAP'] = dap
    d['Stage'] = np.asarray(['Initial','Development','Mid','Late'])[stage]
    d['Kcb'] = k
    d['Plant_height_m'] = h
    d['Root_depth_m'] = root
    d['TAW_mm'] = [p.capacity(z, True) for z in root]
    d['RAW_mm'] = d.TAW_mm*np.asarray(p.mad)[stage]
    d['Kcmax'] = kcmax
    d['Canopy_fraction'] = fc
    d['few'] = np.minimum(1-fc, p.wetted_fraction)
    tmaxf = (d.Tmax_C*1.8+32).clip(50, 86)
    tminf = (d.Tmin_C*1.8+32).clip(50, 86)
    d['GDD_F_day'] = ((tmaxf+tminf)/2-50).clip(lower=0).where(d.DAP >= 0,0)
    d['GDD_F_cumulative'] = d.GDD_F_day.cumsum()
    d['GDD_C_day'] = d.GDD_F_day/1.8
    return d


def runoff(d, p):
    d = d.copy()
    water = d.Rain_mm+d.Irrigation_mm
    antecedent = water.shift(1).rolling(5, min_periods=1).sum().fillna(0)
    low, high = p.antecedent_threshold_mm
    cn = np.select([antecedent < low, antecedent > high], [p.cn[0], p.cn[2]], default=p.cn[1])
    retention = 25400/cn-254
    excess = np.maximum(water-0.2*retention, 0)
    d['Antecedent_5d_mm'] = antecedent
    d['CN'] = cn
    d['Runoff_mm'] = excess**2/np.maximum(water+0.8*retention, 1e-12)
    return d


def simulate(daily, planting_date, p=None):
    """IXN previous-day depletion -> Ks/Kc/ETadj -> DP -> measured reset.

    Full supplied weather history initializes the recurrence, as in the
    spreadsheet. Planting/harvest coverage is applied to exported field totals.
    Measured storage resets are explicit, not hidden in drainage.
    """
    p = p or Parameters()
    p.validate()
    d = daily.copy().sort_values('Date').reset_index(drop=True)
    d['Date'] = pd.to_datetime(d.Date).dt.normalize()
    numeric_checked(d, ['Irrigation_mm'])
    if (d.Irrigation_mm < 0).any():
        raise ValueError('Irrigation cannot be negative.')
    if d.Date.duplicated().any() or not d.Date.diff().dropna().eq(pd.Timedelta(days=1)).all():
        raise ValueError('One unique, consecutive row per day required; never drop missing weather days.')
    d = runoff(d, p)
    if d.empty or pd.Timestamp(planting_date) not in set(d.Date):
        raise ValueError('Weather must include planting date.')
    d = crop_coefficients(d, planting_date, p)
    if 'Observed_storage_mm' not in d:
        d['Observed_storage_mm'] = np.nan
    numeric_checked(d, ['Observed_storage_mm'], allow_missing=True)
    if (d.Observed_storage_mm.dropna() < 0).any():
        raise ValueError('Observed storage cannot be negative.')
    full_fc = p.capacity(p.soil_bottom_m[-1])
    full_taw = p.capacity(p.soil_bottom_m[-1], True)
    full_wp = full_fc-full_taw
    storage = full_fc-p.profile_depletion_initial_mm
    de = p.surface_depletion_initial_mm
    rows = []
    for row in d.itertuples(index=False):
        start = storage
        wetting = row.Rain_mm + row.Irrigation_mm - row.Runoff_mm
        # IXN daily order: previous depletion -> ET, then drainage after ET.
        root_depletion = max(full_fc-start,0.0)
        ks = float(np.clip((row.TAW_mm-root_depletion)/(row.TAW_mm-row.RAW_mm), 0, 1))
        # Same surface recurrence as Evaporation: Kr uses start-of-day De;
        # rainfall/irrigation and Dpe update end-of-day De after evaporation.
        de_start = de
        kr = float(np.clip((p.tew_mm-de_start)/(p.tew_mm-p.rew_mm), 0, 1))
        ke = min(kr*(row.Kcmax-row.Kcb), row.few*row.Kcmax)
        evaporation = max(0.0,ke*row.ETo_mm)
        transpiration = max(0.0, ks*row.Kcb*row.ETo_mm)
        potential = evaporation+transpiration
        eta = evaporation+transpiration
        dp = max(0.0, start+wetting-eta-full_fc)
        predicted = start+wetting-eta-dp
        assimilation = 0.0
        observed = row.Observed_storage_mm
        if p.assimilate_observations and np.isfinite(observed):
            # IXN/Deep Perc.: max(FC_storage - observed TW, 0).
            assimilation = min(observed,full_fc)-predicted
        storage = predicted+assimilation
        dpe = max(wetting-de_start,0.0)
        de = max(de_start-wetting+evaporation/row.few+dpe,0.0)
        delta_s = storage-start
        residual = row.Rain_mm+row.Irrigation_mm+assimilation-eta-row.Runoff_mm-dp-delta_s
        rows.append(dict(Storage_start_mm=start, Storage_predicted_mm=predicted,
                         Storage_end_mm=storage, Delta_storage_mm=delta_s,
                         Assimilation_mm=assimilation, Root_depletion_mm=root_depletion,
                         Ks=ks, Kr=kr, Ke=evaporation/row.ETo_mm if row.ETo_mm > 0 else 0,
                         Surface_depletion_start_mm=de_start, Surface_Dpe_mm=dpe,
                         Surface_depletion_mm=de, Evaporation_mm=evaporation,
                         Transpiration_mm=transpiration, ETa_model_mm=eta,
                         ETc_unstressed_mm=(row.Kcb+ke)*row.ETo_mm,
                         Drainage_mm=dp, Balance_residual_mm=residual,
                         Storage_below_WP=storage < full_wp,
                         Observation_outside_FC_WP=np.isfinite(observed) and (observed < full_wp or observed > full_fc)))
    result = pd.concat([d, pd.DataFrame(rows)], axis=1)
    result.attrs['planting_date'] = pd.Timestamp(planting_date)
    return result


def water_balance_intervals(d):
    """Actual_ET worksheet: measured WB between profiles; ETadj fallback at edges.

    Each record covers (start, end]. A planting-day record is exported separately
    so the interval totals can be reconciled with all daily season totals.
    """
    rows = []
    planting = pd.Timestamp(d.attrs.get('planting_date', d.Date.min()))
    season = d.loc[d.Date >= planting]
    if season.empty:
        return pd.DataFrame()
    observed = season.loc[season.Observed_storage_mm.notna(), ['Date','Observed_storage_mm']]
    bounds = sorted(set([season.Date.min(), season.Date.max()] + observed.Date.tolist()))
    # Daily planting flux precedes the spreadsheet's strict (planting,first] interval.
    pairs = [(bounds[0]-pd.Timedelta(days=1), bounds[0])] + list(zip(bounds[:-1],bounds[1:]))
    for start, end in pairs:
        block = season.loc[(season.Date > start) & (season.Date <= end)]
        rain, irr, ro, dp, eta = [float(block[c].sum()) for c in ['Rain_mm','Irrigation_mm','Runoff_mm','Drainage_mm','ETa_model_mm']]
        av = observed.loc[observed.Date == start, 'Observed_storage_mm']
        bv = observed.loc[observed.Date == end, 'Observed_storage_mm']
        measured = len(av) == len(bv) == 1
        delta = float(bv.iloc[0]-av.iloc[0]) if measured else np.nan
        wb = rain+irr-ro-dp-delta if measured else np.nan
        model_start = float(block.Storage_start_mm.iloc[0])
        model_end = float(block.Storage_end_mm.iloc[-1])
        adjustment = float(block.Assimilation_mm.sum())
        rows.append(dict(Start_date=start, End_date=end, Days=len(block), Rain_mm=rain,
                         Irrigation_mm=irr, Runoff_mm=ro, Drainage_mm=dp, Delta_storage_mm=delta,
                         ETa_model_mm=eta, ETa_WB_mm=wb,
                         ETa_Actual_mm=wb if measured else eta,
                         WB_method='measured_balance' if measured else 'two_step_fallback',
                         WB_negative=bool(measured and wb < 0),
                         Blank_irrigation_days=int(block.get('Blank_irrigation_imputed',pd.Series(dtype=bool)).sum()),
                         Assimilation_mm=adjustment, WB_minus_model_mm=wb-eta,
                         Closure_with_assimilation_mm=wb+adjustment-eta,
                         Model_budget_closure_mm=rain+irr-ro-dp+adjustment-(model_end-model_start)-eta))
    return pd.DataFrame(rows)


def leaching_intervals(d, basis='unverified', method='end_sample'):
    """C(mg/L)*DP(mm)*0.01 = kg of reported analyte / ha.

    end_sample matches the original interval convention; linear interpolates
    between measured endpoints, without extrapolation. basis is NO3-N, NO3,
    or unverified. Missing values and sentinels are not zero measurements.
    """
    if basis not in ['NO3-N','NO3','unverified'] or method not in ['end_sample','linear']:
        raise ValueError('Unsupported concentration basis or interval method.')
    if 'Nitrate_mg_L' not in d:
        return pd.DataFrame()
    d = d.copy()
    numeric_checked(d, ['Nitrate_mg_L'], allow_missing=True)
    if (d.Nitrate_mg_L.dropna() < 0).any():
        raise ValueError('Nitrate concentration cannot be negative.')
    samples = d.loc[d.Nitrate_mg_L.notna(), ['Date','Nitrate_mg_L']]
    rows = []
    for i in range(1, len(samples)):
        a, b = samples.iloc[i-1], samples.iloc[i]
        block = d.loc[(d.Date > a.Date) & (d.Date <= b.Date)]
        if method == 'end_sample':
            concentrations = np.full(len(block), b.Nitrate_mg_L)
        else:
            fraction = ((block.Date-a.Date)/(b.Date-a.Date)).to_numpy()
            concentrations = a.Nitrate_mg_L+(b.Nitrate_mg_L-a.Nitrate_mg_L)*fraction
        load = float(np.sum(0.01*concentrations*block.Drainage_mm.to_numpy()))
        nitrogen = load if basis == 'NO3-N' else load*14.0067/62.0049 if basis == 'NO3' else np.nan
        rows.append(dict(Start_date=a.Date, End_date=b.Date, Days=len(block),
                         Drainage_mm=float(block.Drainage_mm.sum()),
                         Blank_irrigation_days=int(block.get('Blank_irrigation_imputed',pd.Series(dtype=bool)).sum()),
                         Start_concentration_mg_L=a.Nitrate_mg_L, End_concentration_mg_L=b.Nitrate_mg_L,
                         Load_reported_analyte_kg_ha=load, Load_reported_analyte_lb_ac=load*KG_HA_TO_LB_AC,
                         Load_legacy_0p89_lb_ac=load*0.89, Load_N_kg_ha=nitrogen,
                         Concentration_basis=basis, Concentration_method=method))
    return pd.DataFrame(rows)


def parameters_dict(p):
    return asdict(p)
