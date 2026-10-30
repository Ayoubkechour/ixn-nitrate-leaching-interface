"""Check the user's one-plot workbook equations using its cached operands.

Cached operands isolate equation agreement from the workbook's date/reference
errors. This workbook is a calculation reference, never a raw field input.
"""
from dataclasses import replace
from pathlib import Path
import numpy as np
import pandas as pd
import openpyxl
from leaching_model import Parameters, reference_et, crop_coefficients, simulate

REFERENCE = Path(__file__).resolve().parent/'113_2022_IxN_Becker_I1N1.xlsx'


def validate_workbook(path=REFERENCE):
    formulas = openpyxl.load_workbook(path, data_only=False)
    values = openpyxl.load_workbook(path, data_only=True)
    checks, issues = [], []
    def compare(name, calculated, cached):
        calculated, cached = np.asarray(calculated,float), np.asarray(cached,float)
        error = float(np.max(np.abs(calculated-cached)))
        checks.append(dict(Check=name, Rows=len(cached), Max_abs_error=error, Passed=error < 1e-8))
    def cached(sheet, col, start, end):
        return np.asarray([values[sheet][f'{col}{r}'].value for r in range(start,end+1)],float)
    et = values['ETref']
    weather = pd.DataFrame([dict(Date=et[f'A{r}'].value,
        Tmin_C=et[f'B{r}'].value, Tmax_C=et[f'C{r}'].value,
        RHmin_pct=et[f'D{r}'].value, RHmax_pct=min(et[f'E{r}'].value,100),
        Wind_m_s=et[f'F{r}'].value, Rs_MJ_m2_day=et[f'G{r}'].value*.0864,
        Rain_mm=et[f'H{r}'].value) for r in range(15,229)])
    # Latitude/elevation and rounded Julian day are the workbook's actual operands.
    out = reference_et(weather, np.rad2deg(values['User_Input']['L18'].value), 552,
                       julian_override=cached('ETref','J',15,228))
    for output,col in [('ETo_mm','AG'),('ETr_mm','AH'),('Gamma_kPa_C','S'),
                       ('Ra_MJ_m2_day','AB'),('Rnl_MJ_m2_day','AE')]:
        compare('workbook '+output, out[output], cached('ETref',col,15,228))
    ev = values['Evaporation']
    climate = pd.DataFrame(dict(
        Date=pd.Timestamp('2022-01-01')+pd.to_timedelta(cached('Evaporation','L',18,231)-1,unit='D'),
        Tmax_C=cached('Evaporation','C',18,231), Tmin_C=cached('Evaporation','B',18,231),
        U2_m_s=cached('Evaporation','M',18,231), RHmin_pct=cached('Evaporation','D',18,231)))
    coeff = crop_coefficients(climate,'2022-05-16',replace(Parameters(),stage_days=(30,50,50,38)))
    for output,col in [('Kcb','Q'),('Plant_height_m','R'),('Root_depth_m','S'),
                       ('TAW_mm','T'),('RAW_mm','U'),('Kcmax','V')]:
        compare('workbook '+output,coeff[output],cached('Evaporation',col,18,231))
    formula_rows = [r for r in range(18,232) if formulas['Evaporation'][f'W{r}'].data_type == 'f']
    compare('workbook canopy expression (formula cells)', coeff.Canopy_fraction.iloc[np.array(formula_rows)-18],
            [ev[f'W{r}'].value for r in formula_rows])
    # Daily recurrence tests use cached start states; manual overrides elsewhere
    # cannot propagate into the equation agreement check.
    kr = np.clip((12.75-cached('Evaporation','AA',18,231))/(12.75-10),0,1)
    compare('workbook Kr',kr,cached('Evaporation','AB',18,231))
    daily = climate.copy()
    daily['ETo_mm'] = cached('Evaporation','J',18,231)
    daily['Rain_mm'] = cached('Evaporation','G',18,231)
    daily['Irrigation_mm'] = cached('Evaporation','H',18,231)
    modeled = simulate(daily,'2022-05-16',replace(Parameters(),stage_days=(30,50,50,38)))
    # Verify the production recurrence, through the last intact formula row.
    # Workbook lookups lost irrigation/observations to timestamps; these cached
    # operands test parity, while field runs use corrected raw-date joins.
    for sheet,output,col in [('Evaporation','Runoff_mm','I'),('Evaporation','Ke','AC'),
            ('Evaporation','Surface_depletion_mm','AF'),('Deep Perc.','Ks','AC'),
            ('Deep Perc.','Drainage_mm','AF'),('Deep Perc.','ETa_model_mm','AE')]:
        compare('production recurrence '+output,modeled[output].iloc[:204],cached(sheet,col,18,221))
    dep = values['Deep Perc.']
    dp = []; profile = []; expected_profile = []
    for r in range(18,232):
        previous = dep['L6'].value if r == 18 else dep[f'AG{r-1}'].value
        wet = dep[f'D{r}'].value-dep[f'F{r}'].value+dep[f'E{r}'].value
        calculated_dp = max(wet-dep[f'AE{r}'].value-previous,0)
        dp.append(calculated_dp)
        # Worksheet AG reads next-row T, a documented reference error.
        next_observed = dep[f'T{r+1}'].value
        profile.append(previous-wet+dep[f'AE{r}'].value+calculated_dp if next_observed is None else next_observed)
        expected_profile.append(dep[f'AG{r}'].value)
    compare('workbook drainage recurrence',dp,cached('Deep Perc.','AF',18,231))
    compare('workbook depletion recurrence (cached references)',profile,expected_profile)
    for r in range(18,232):
        cell = formulas['Evaporation'][f'W{r}']
        if cell.data_type != 'f':
            issues.append(dict(Sheet='Evaporation',Cell=cell.coordinate,
                Issue='Manual canopy override',Value=cell.value))
    issues.extend([
        dict(Sheet='ETref',Cell='B15:G228',Issue='Weather operands reference the following User_Input row; rain references current row',Value='align weather by normalized calendar date'),
        dict(Sheet='ETref',Cell='J15:J228',Issue='TEXT rounds Julian days with 23:59 time into the next day',Value='use calendar day of year'),
        dict(Sheet='ETref',Cell='R15:AC228',Issue='Elevation hardcoded 552 m',Value='raw Becker station 942 ft = 287.1216 m'),
        dict(Sheet='Deep Perc.',Cell='AG19:AG231',Issue='Observed depletion reset references next row T',Value='use same-day complete observation'),
        dict(Sheet='User_Input',Cell='A15:A228',Issue='Weather times 23:59; irrigation/moisture at midnight fail exact lookup',Value='normalize all daily dates'),
        dict(Sheet='Actual_ET',Cell='H8:N28',Issue='Midnight end bounds exclude 23:59 weather on the end date',Value='consistent normalized (start,end] intervals'),
        dict(Sheet='GDD',Cell='P34',Issue='Workbook Tmax cap 34 C differs from IXN 86 F (30 C)',Value='retain IXN 86 F cap'),
    ])
    formulas.close(); values.close()
    return pd.DataFrame(checks),pd.DataFrame(issues)


if __name__ == '__main__':
    checks, issues = validate_workbook()
    print(checks.to_string(index=False))
    print(issues.to_string(index=False))
    if not checks.Passed.all():
        raise AssertionError('Workbook equation check failed.')
