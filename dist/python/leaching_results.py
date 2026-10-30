"""Plot × year result tables and scientific figures from the calculated totals."""
from pathlib import Path
import re
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.lines import Line2D

COLORS = {'I1':'#126b80','I2':'#d28122','I3':'#7655a2','I4':'#497d40'}
METRICS = [
    ('Load_kg_ha','Sample-covered load (kg/ha)'),
    ('WB_ETa_mm','WB_ETa + model fallback (mm)'),
    ('Model_ETa_mm','Two-step ETa (mm)'),
    ('WB_ETa_measured_mm','Measured-interval WB ETa (mm)'),
    ('Drainage_mm','Deep percolation (mm)'),
    ('Runoff_mm','Runoff (mm)'),
    ('Rain_mm','Rainfall (mm)'),
    ('Irrigation_mm','Irrigation (mm)'),
    ('ETo_mm','Reference ETo (mm)'),
    ('ETr_mm','Reference ETr (mm)'),
    ('Evaporation_mm','Evaporation (mm)'),
    ('Transpiration_mm','Transpiration (mm)'),
    ('Storage_change_mm','Profile storage change (mm)'),
    ('Assimilation_mm','Observation reset adjustment (mm)'),
    ('GDD_F_day','Accumulated GDD (F degree days)'),
    ('Mean_Ks','Mean stress coefficient Ks'),
]


def plot_year_table(summary):
    """Keep all totals, with familiar Load/WB_ETa names and explicit coverage."""
    result = summary.rename(columns={
        'Load_reported_analyte_kg_ha':'Load_kg_ha',
        'Load_reported_analyte_lb_ac':'Load_lb_ac',
        'ETa_Actual_mm':'WB_ETa_mm',
        'ETa_WB_covered_mm':'WB_ETa_measured_mm',
        'ETa_model_mm':'Model_ETa_mm',
        'ETa_model_WB_covered_mm':'Model_ETa_WB_covered_mm',
    }).copy()
    if result.duplicated(['Dataset','Site','Plot','Year']).any():
        raise ValueError('Expected exactly one result per dataset/site/plot/year.')
    result['Storage_change_mm'] = result.Storage_final_mm-result.Storage_initial_mm
    result['WB_ETa_source'] = np.where(result.WB_days > 0,
        'measured_balance_plus_two_step_fallback','two_step_only_no_complete_profiles')
    first = ['Plot','Year','Site','Dataset','Irrigation_treatment','Nitrogen_treatment','Rep',
             'Load_kg_ha','Load_lb_ac','Load_N_kg_ha','WB_ETa_mm','WB_ETa_measured_mm',
             'Model_ETa_mm','Rain_mm','Irrigation_mm','Runoff_mm','Drainage_mm',
             'Evaporation_mm','Transpiration_mm','ETo_mm','ETr_mm','Storage_change_mm',
             'WB_ETa_source','WB_days','Days','Leaching_days']
    return result[first+[c for c in result if c not in first]].sort_values(
        ['Dataset','Site','Year','Plot']).reset_index(drop=True)


def result_dictionary():
    return pd.DataFrame([
        ('Load_kg_ha','Reported-analyte load, kg/ha; assumed mg/L basis. Paired nitrate dates only.'),
        ('Load_lb_ac','Same load in lb/ac using the precise conversion.'),
        ('Load_N_kg_ha','Nitrogen mass only if the configured lab analyte basis is verified.'),
        ('WB_ETa_mm','Actual_ET worksheet total: measured water balance plus two-step ET fallback; covers all season days.'),
        ('WB_ETa_measured_mm','Measured-profile intervals only. Missing where no complete profile pairs exist.'),
        ('Model_ETa_mm','Two-step ET over all season days.'),
        ('Model_ETa_WB_covered_mm','Two-step ET over the same intervals as WB_ETa_measured_mm.'),
        ('WB_ETa_source','Distinguishes partial measured-balance coverage from entirely modeled fallback.'),
        ('WB_days','Days covered by measured-profile water-balance intervals.'),
        ('Leaching_days','Days covered by paired valid nitrate samples; load is not extrapolated.'),
        ('Storage_change_mm','Final minus initial modeled/assimilated profile storage.'),
        ('Assimilation_mm','Signed adjustment from observed storage resets; separate water budget term.'),
        ('Blank_irrigation_days','Logged blank irrigation amounts modeled under the configured zero-fill scenario.'),
        ('Result_status','Existing scientific/data limitations attached to each plot-year result.'),
    ],columns=['Column','Definition'])


def draw_plot_year_figures(result, output, dataset_status=None):
    """Year overview plus every plot's totals in one page per dataset/site/year."""
    output = Path(output)
    folder = output/'plot_year_figures'
    folder.mkdir(parents=True,exist_ok=True)
    index = []
    legend = [Line2D([],[],marker='o',linestyle='',color=color,label=trt)
              for trt,color in COLORS.items() if trt in set(result.Irrigation_treatment)]
    legend.append(Line2D([],[],marker='o',linestyle='',markerfacecolor='none',
                        color='#555555',label='WB_ETa: model fallback only'))
    with PdfPages(output/'plot_year_results.pdf') as pdf:
        for (dataset,site,year), group in result.groupby(['Dataset','Site','Year'],sort=True):
            group = group.sort_values('Plot').reset_index(drop=True)
            fig,axes = plt.subplots(4,4,figsize=(16,13),sharex=True)
            x = np.arange(len(group))
            for ax,(metric,label) in zip(axes.flat,METRICS):
                for trt,sub in group.groupby('Irrigation_treatment',sort=True):
                    color = COLORS.get(trt,'#555555')
                    valid = sub[metric].notna()
                    if metric == 'WB_ETa_mm':
                        for measured in [False,True]:
                            points = sub.loc[valid & sub.WB_days.gt(0).eq(measured)]
                            ax.scatter(points.index,points[metric],s=18,edgecolors=color,
                                       facecolors=color if measured else 'none',linewidths=.8)
                    else:
                        ax.scatter(sub.index[valid],sub.loc[valid,metric],s=18,color=color)
                if group[metric].notna().any():
                    if group[metric].min() < 0:
                        ax.axhline(0,color='#777777',lw=.7)
                else:
                    text = 'Complete moisture profiles unavailable' if metric == 'WB_ETa_measured_mm' else 'No valid observations'
                    ax.text(.5,.5,text,transform=ax.transAxes,ha='center',va='center',fontsize=9,wrap=True)
                ax.set_title(label,fontsize=10)
                ax.grid(axis='y',alpha=.2)
                ticks = np.unique(np.linspace(0,len(group)-1,min(8,len(group))).astype(int))
                ax.set_xticks(ticks)
                ax.set_xticklabels(group.Plot.iloc[ticks].astype(str),rotation=45,ha='right',fontsize=8)
                ax.set_xlim(-1,len(group))
            for ax in axes[-1]:
                ax.set_xlabel('Plot ID')
            fig.suptitle(f'{site} {year} · {dataset} · results for every field plot',fontsize=16,y=.985)
            fig.legend(handles=legend,loc='upper center',bbox_to_anchor=(.5,.955),ncol=5,frameon=False)
            fig.text(.5,.022,'Load covers paired nitrate dates. WB_ETa uses measured balance where available and two-step fallback elsewhere.',ha='center',fontsize=9)
            fig.text(.5,.008,'Reported-analyte load assumes mg/L; lab-date proxy and blank-irrigation scenarios retain the recorded result limitations.',ha='center',fontsize=9)
            fig.tight_layout(rect=[0,.045,1,.92])
            name = re.sub(r'[^A-Za-z0-9_-]','_',f'{dataset}_{site}_{year}_plot_year')
            png = folder/(name+'.png')
            fig.savefig(png,dpi=140)
            fig.savefig(folder/(name+'.pdf'))
            pdf.savefig(fig)
            plt.close(fig)
            index.append(dict(Dataset=dataset,Site=site,Year=year,
                              Figure=str(png.relative_to(output)),Kind='all plot-year values'))
    pairs = list(result.groupby(['Dataset','Site'],sort=True))
    overview_metrics = [METRICS[i] for i in [0,1,2,4]]
    fig,axes = plt.subplots(len(pairs),4,figsize=(16,4*len(pairs)),squeeze=False)
    for row,((dataset,site),group) in enumerate(pairs):
        years = sorted(group.Year.unique())
        if dataset_status is not None and not dataset_status.empty:
            years = sorted(set(years) | set(dataset_status.loc[dataset_status.Site.eq(site),'Year']))
        for ax,(metric,label) in zip(axes[row],overview_metrics):
            for i,year in enumerate(years):
                annual = group.loc[group.Year.eq(year)]
                valid = annual.loc[annual[metric].notna()]
                if annual.empty:
                    ax.text(i,.03,'Excluded',ha='center',fontsize=9,transform=ax.get_xaxis_transform())
                for trt,sub in valid.groupby('Irrigation_treatment',sort=True):
                    offset = (list(COLORS).index(trt)-1.5)*.07 if trt in COLORS else 0
                    jitter = np.linspace(-.018,.018,len(sub))
                    color = COLORS.get(trt,'#555555')
                    if metric == 'WB_ETa_mm':
                        for measured in [False,True]:
                            mask = sub.WB_days.gt(0).eq(measured).to_numpy()
                            ax.scatter((i+offset+jitter)[mask],sub.loc[mask,metric],s=17,
                                       edgecolors=color,facecolors=color if measured else 'none',linewidths=.7,alpha=.7)
                    else:
                        ax.scatter(i+offset+jitter,sub[metric],s=17,color=color,alpha=.7)
                if len(valid):
                    ax.plot([i-.21,i+.21],[valid[metric].median()]*2,color='black',lw=2)
            ax.set_xticks(range(len(years)));ax.set_xticklabels(years)
            ax.set_title(f'{site}: {label}',fontsize=11)
            ax.set_xlabel('Year');ax.grid(axis='y',alpha=.2)
            ax.set_xlim(-.5,len(years)-.5)
    fig.suptitle('Results by year · each point is a plot; black line is the median',fontsize=15,y=.99)
    fig.legend(handles=legend,loc='upper center',bbox_to_anchor=(.5,.96),ncol=5,frameon=False)
    fig.text(.5,.015,'WB_ETa includes explicit model fallback. Loads cover paired nitrate samples; data limitations remain attached to the results.',ha='center',fontsize=9)
    fig.tight_layout(rect=[0,.045,1,.9])
    fig.savefig(output/'year_load_wbeta.png',dpi=140)
    fig.savefig(output/'year_load_wbeta.pdf')
    plt.close(fig)
    return pd.DataFrame(index)
