"""Verify real regression values and the interface's scientific input boundary."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'dist'/'python'))
from interface_engine import analyze, prepared_tables, parameters_from_form, PR2_COLUMNS, PR2_WEIGHTS_MM, read_table
from leaching_model import Parameters
from leaching_sources import Sources


class InputTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='ixn-input-test-')
        self.root=Path(self.tmp.name)
        self.config=dict(mode='tables',dataset='Test',site='Test field',planting_date='2022-05-16',end_date='2022-08-31',
            latitude_deg=45.34399,elevation_m=287.1216,wind_height_m=3,irrigation_complete=True,
            files={role:str(HERE/'dist'/'templates'/('example_'+role+'.csv')) for role in ['weather','irrigation','nitrate','moisture','plots']})

    def tearDown(self):self.tmp.cleanup()

    def modified(self,role,modify):
        table=pd.read_csv(self.config['files'][role]);table=modify(table)
        path=self.root/(role+'.csv');table.to_csv(path,index=False);self.config['files'][role]=str(path)

    def test_missing_end_date_is_rejected(self):
        self.modified('weather',lambda d:d.iloc[:-1])
        with self.assertRaisesRegex(ValueError,'final day'):analyze(self.config,self.root)

    def test_interior_gap_is_rejected(self):
        self.modified('weather',lambda d:d.drop(index=30))
        with self.assertRaisesRegex(ValueError,'missing days'):analyze(self.config,self.root)

    def test_duplicate_observations_are_rejected(self):
        self.modified('nitrate',lambda d:pd.concat([d,d.iloc[:1]],ignore_index=True))
        with self.assertRaisesRegex(ValueError,'duplicate'):analyze(self.config,self.root)

    def test_unlogged_irrigation_requires_confirmation(self):
        self.config['irrigation_complete']=False
        with self.assertRaisesRegex(ValueError,'complete event log'):analyze(self.config,self.root)

    def test_blank_logged_irrigation_stops_by_default(self):
        def edit(d):d.loc[0,'Irrigation_mm']=None;return d
        self.modified('irrigation',edit)
        with self.assertRaisesRegex(ValueError,'blank amounts'):analyze(self.config,self.root)

    def test_plot_map_cannot_silently_drop_observations(self):
        self.modified('plots',lambda d:d.iloc[:-1])
        with self.assertRaisesRegex(ValueError,'does not cover'):analyze(self.config,self.root)

    def test_negative_nitrate_is_rejected(self):
        def edit(d):d.loc[0,'Nitrate_mg_L']=-1;return d
        self.modified('nitrate',edit)
        with self.assertRaisesRegex(ValueError,'negative'):analyze(self.config,self.root)

    def test_workbook_and_individual_override(self):
        tables=prepared_tables(dict(workbook=str(HERE/'dist/templates/input_template.xlsx')))
        self.assertEqual(set(tables),{'weather','irrigation','nitrate','moisture','plots'})
        override=self.root/'nitrate.csv'
        pd.DataFrame([dict(Date='2022-06-01',Plot=101,Nitrate_mg_L=42)]).to_csv(override,index=False)
        tables=prepared_tables(dict(workbook=str(HERE/'dist/templates/input_template.xlsx'),nitrate=str(override)))
        self.assertEqual(tables['nitrate'].Nitrate_mg_L.iloc[0],42)

    def test_pr2_depths_are_preserved_and_integrated_only_when_complete(self):
        def edit(table):
            table.loc[0, PR2_COLUMNS[-1]] = None
            return table
        self.modified('moisture', edit)
        table=prepared_tables(self.config['files'])['moisture']
        self.assertTrue(set(PR2_COLUMNS) <= set(table.columns))
        self.assertFalse(bool(table.loc[0,'Complete_profile']))
        self.assertTrue(pd.isna(table.loc[0,'Observed_storage_mm']))
        expected=(table.loc[1,PR2_COLUMNS].to_numpy(dtype=float)/100*PR2_WEIGHTS_MM).sum()
        self.assertAlmostEqual(table.loc[1,'Observed_storage_mm'], expected)
        self.assertAlmostEqual(table.loc[1,'Profile_depth_m'], .9144)

    def test_pr2_spreadsheet_westport_sheet_is_accepted(self):
        path=self.root/'pr2.xlsx'
        with pd.ExcelWriter(path) as writer:
            pd.DataFrame({'Other':[1]}).to_excel(writer,sheet_name='Notes',index=False)
            pd.read_csv(self.config['files']['moisture']).to_excel(writer,sheet_name='Westport',index=False)
        self.assertEqual(read_table(path,'moisture').columns.tolist()[:2],['Date','Plot'])
        self.config['files']['moisture']=str(path)
        self.assertEqual(len(prepared_tables(self.config['files'])['moisture']),18)

    def test_pr2_profile_depth_is_reflected_in_results(self):
        with patch('interface_engine.draw_plot_year_figures',return_value=pd.DataFrame()):
            result,_=analyze(self.config,self.root,lambda message:None)
        self.assertTrue(all(abs(row['Model_profile_depth_m']-.9144)<1e-9 for row in result['plot_year']))
        self.assertIn('6in_VWC %',result['daily'][0])

    def test_pr2_rejects_unmatched_custom_profile(self):
        self.config['parameters']={'soil_bottom_m':[.3,.6,.9,1.1]}
        with self.assertRaisesRegex(ValueError,'0.9144 m'):
            analyze(self.config,self.root,lambda message:None)

    def test_invalid_parameter_lengths_and_nan(self):
        for settings in [{'soil_bottom_m':[.3,.6]}, {'kcb_mid':float('nan')}, {'cn':[80,60,90]}, {'stage_days':[30.5,50,50,37]}, {'tew_mm':8,'rew_mm':10}]:
            with self.subTest(settings=settings):
                with self.assertRaises(ValueError):parameters_from_form(settings)

    def test_water_only_outputs_preserve_missing_load_and_measured_wb(self):
        self.config['files']={k:v for k,v in self.config['files'].items() if k not in ['nitrate','moisture']}
        with patch('interface_engine.draw_plot_year_figures',return_value=pd.DataFrame()):
            result,archive=analyze(self.config,self.root,lambda message:None)
        for row in result['plot_year']:
            self.assertIsNone(row['Load_kg_ha'])
            self.assertIsNone(row['WB_ETa_measured_mm'])
            self.assertAlmostEqual(row['WB_ETa_mm'],row['Model_ETa_mm'])
        self.assertEqual(len(result['daily_plots']),len(result['plot_year']))
        self.assertEqual(result['daily_id'],result['daily_plots'][0]['id'])
        for item in result['daily_plots']:
            records=json.loads((self.root/'daily_previews'/(item['id']+'.json')).read_text())
            self.assertEqual(len(records),108)
            self.assertTrue(all(row['Nitrate_mg_L'] is None for row in records))

    def test_microgram_conversion_and_flagged_blank_irrigation(self):
        def edit(d):d.loc[0,'Irrigation_mm']=None;return d
        self.modified('irrigation',edit)
        self.config.update(blank_irrigation_policy='flag_zero',nitrate_basis='NO3-N',collection_dates_verified=True,concentration_units='mg/L')
        with patch('interface_engine.draw_plot_year_figures',return_value=pd.DataFrame()):
            baseline,_=analyze(self.config,self.root/'mg',lambda message:None)
            self.modified('nitrate',lambda d:d.assign(Nitrate_mg_L=d.Nitrate_mg_L*1000))
            self.config['concentration_units']='ug/L'
            converted,_=analyze(self.config,self.root/'ug',lambda message:None)
        for a,b in zip(baseline['plot_year'],converted['plot_year']):
            self.assertAlmostEqual(a['Load_kg_ha'],b['Load_kg_ha'])
        self.assertEqual(converted['plot_year'][0]['Blank_irrigation_days'],1)
        self.assertEqual(converted['plot_year'][0]['Result_status'],'provisional_blank_irrigation_zero_scenario')


class RegressionTest(unittest.TestCase):
    @unittest.skipUnless((HERE.parent.parent/'Raw_data_NNI').is_dir(),'Original local data not available')
    def test_plot_113_matches_recalculated_spreadsheet_values(self):
        with tempfile.TemporaryDirectory(prefix='ixn-113-regression-') as name:
            root=Path(name);src=Sources(HERE.parent.parent/'Raw_data_NNI',HERE.parent)
            weather=src.weather('Becker',2022,'2022-05-16','2022-10-31',Parameters())
            weather[['Date','Tmax_C','Tmin_C','Wind_m_s','Rs_MJ_m2_day','Rain_mm','Tdew_C']].to_csv(root/'weather.csv',index=False)
            irrigation=src.irrigation()
            irrigation=irrigation.loc[irrigation.Site.eq('Becker') & irrigation.Year.eq(2022) & irrigation.Irrigation_treatment.eq('I1'),['Date','Irrigation_mm']].copy()
            irrigation['Plot']=113;irrigation.to_csv(root/'irrigation.csv',index=False)
            nitrate=src.nitrate()
            nitrate.loc[nitrate.Site.eq('Becker') & nitrate.Year.eq(2022) & nitrate.Plot.eq(113),['Date','Plot','Nitrate_mg_L']].to_csv(root/'nitrate.csv',index=False)
            cfg=dict(mode='tables',dataset='Regression',site='Becker',planting_date='2022-05-16',end_date='2022-10-31',latitude_deg=45.34399,elevation_m=942*.3048,wind_height_m=3,irrigation_complete=True,blank_irrigation_policy='flag_zero',files={role:str(root/(role+'.csv')) for role in ['weather','irrigation','nitrate']})
            result,archive=analyze(cfg,root,lambda message:None)
            row=result['plot_year'][0]
            for key,expected in [('Model_ETa_mm',517.0214815765762),('WB_ETa_mm',517.0214815765762),('Drainage_mm',35.46923417402249),('Load_kg_ha',1.3030529121471923)]:
                self.assertAlmostEqual(row[key],expected,places=8,msg=key)
            self.assertIsNone(row['WB_ETa_measured_mm'])
            self.assertIsNone(row['Load_N_kg_ha'])
            self.assertEqual(row['WB_ETa_source'],'two_step_only_no_complete_profiles')
            self.assertTrue(archive.is_file())
            self.assertTrue(all(r['Passed'] for r in result['checks']))


if __name__=='__main__':unittest.main(verbosity=2)
