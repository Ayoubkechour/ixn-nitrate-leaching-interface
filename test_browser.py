"""End-to-end browser QA for both native and hosted/browser calculation paths.

Optional dependency: Playwright with Chromium. Start serve.py on 8765 and a
static server on 8766, then run this script. Generated artifacts go to /tmp.
"""
import asyncio
import json
import sys
import math
from pathlib import Path
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,args=['--no-sandbox','--ignore-certificate-errors'])
        context=await browser.new_context(viewport=dict(width=1440,height=1050),accept_downloads=True,ignore_https_errors=True)
        page=await context.new_page()
        errors=[]
        page.on('console',lambda message:print(message.text,flush=True) if message.text.startswith('QA_PROGRESS') else None)
        page.on('pageerror',lambda error:errors.append(str(error)))
        modes=[(8765,'native'),(8766,'browser')]
        if '--browser-only' in sys.argv:modes=[(8766,'browser')]
        if '--native-only' in sys.argv:modes=[(8765,'native')]
        for port,mode in modes:
            await page.goto(f'http://127.0.0.1:{port}',wait_until='networkidle')
            await page.screenshot(path=f'/tmp/ixn_{mode}_inputs.png',full_page=True)
            await page.locator('#exampleButton').click()
            await page.wait_for_function("document.querySelector('#dataset').value === 'Synthetic 2022 site-year'")
            await page.locator('[data-view="review"]').click()
            await page.screenshot(path=f'/tmp/ixn_{mode}_review.png',full_page=True)
            await page.evaluate("new MutationObserver(() => console.log('QA_PROGRESS ' + document.querySelector('#progressTitle').textContent)).observe(document.querySelector('#progressTitle'),{childList:true,subtree:true})")
            await page.locator('#runButton').click()
            try:
                await page.wait_for_function("!document.querySelector('#resultsContent').classList.contains('hidden') || !document.querySelector('#errorPanel').classList.contains('hidden')",timeout=240000)
            except Exception:
                print(mode,'PROGRESS',await page.locator('#progressLog').inner_text(),flush=True)
                raise
            error=await page.locator('#errorPanel').inner_text()
            if error:
                print(mode,'ERROR',error,flush=True)
                print('PROGRESS',await page.locator('#progressLog').inner_text(),flush=True)
                raise AssertionError(error)
            await page.screenshot(path=f'/tmp/ixn_{mode}_results.png',full_page=True)
            rows=await page.locator('#resultsTable tbody tr').count()
            assert rows==96,(mode,rows)
            assert await page.locator('#dailyPlot option').count()==96
            await page.locator('[data-result-tab="daily"]').click()
            await page.locator('#dailyPlot').select_option(index=2)
            await page.wait_for_function("document.querySelector('#dailyTitle').textContent.includes('plot 103') && !!document.querySelector('#dailyChart svg')")
            await page.wait_for_function("document.querySelector('#nitrateChartTitle').textContent.includes('plot 103') && document.querySelector('#nitrateSamplesTable tbody tr')")
            sample_check=await page.evaluate("""() => {
                const selected = document.querySelector('#dailyPlot').value;
                const cache = state.dailyCache.get(selected);
                const sample = cache.observations.find(row => Number.isFinite(row.Nitrate_mg_L));
                return {plot: sample.Plot, value: sample.Nitrate_mg_L, table: document.querySelector('#nitrateSamplesTable').textContent};
            }""")
            assert sample_check['plot']==103,sample_check
            assert f"{sample_check['value']:.3f}" in sample_check['table'],sample_check
            assert await page.locator('#storageChart svg').count()==1
            assert await page.locator('#etChart svg').count()==1
            await page.locator('[data-et-view="cumulative"]').click()
            assert await page.locator('#etChart svg').count()==1
            await page.locator('[data-et-view="monthly"]').click()
            assert await page.locator('#depthChart svg').count()==1
            assert await page.locator('#depthChart .axis-unit').inner_text()=='VWC %'
            await page.locator('[data-depth-view="lines"]').click()
            assert await page.locator('#depthChartLegend span').count()==5
            await page.locator('[data-depth-view="matrix"]').click()
            assert await page.locator('#nitrateChart svg').count()==1
            assert '169 model days' in await page.locator('#dailyCoverage').inner_text()
            await page.locator('[data-result-tab="comparison"]').click()
            assert await page.locator('#comparisonTable tbody tr').count()==24
            assert await page.locator('#comparisonMatrix .matrix-cell').count()==24
            await page.locator('#comparisonGroup').select_option('years')
            assert await page.locator('#comparisonTable tbody tr').count()==1
            stats=await page.evaluate("comparisonRows([null,0,4].map(value=>({...state.results.plot_year[0],Load_kg_ha:value})),'Load_kg_ha',false)[0]")
            assert stats['n']==2 and stats['Missing']==1 and stats['Mean']==2,stats
            assert abs(stats['SD']-math.sqrt(8))<1e-12,stats
            async with page.expect_download() as comparison_download:
                await page.locator('#downloadComparison').click()
            await (await comparison_download.value).save_as(f'/tmp/ixn_{mode}_comparison.csv')
            await page.locator('#irrigationFilter').select_option('I2')
            assert await page.locator('#dailyPlot option').count()==24
            assert await page.locator('#resultsTable tbody tr').count()==24
            await page.wait_for_function("document.querySelector('#dailyTitle').textContent.includes('plot 107') && !!document.querySelector('#dailyChart svg')")
            await page.locator('#nitrogenFilter').select_option('N1')
            assert await page.locator('#dailyPlot option').count()==4
            assert await page.locator('#resultsTable tbody tr').count()==4
            await page.locator('#irrigationFilter').select_option('all')
            await page.locator('#nitrogenFilter').select_option('all')
            await page.locator('[data-result-tab="data"]').click()
            await page.locator('#chartMetric').select_option('Drainage_mm')
            assert await page.locator('#resultsTable tbody tr').count()==96
            await page.locator('#resultFilter').select_option(index=1)
            assert await page.locator('#resultsTable tbody tr').count()==96
            async with page.expect_download() as download_info:
                await page.locator('#downloadAll').click()
            download=await download_info.value
            await download.save_as(f'/tmp/ixn_{mode}_outputs.zip')
            await page.locator('[data-result-tab="data"]').click()
            assert await page.locator('#checksList .quality-item').count()>=8
            result=await page.evaluate('state.results')
            Path(f'/tmp/ixn_{mode}_preview.json').write_text(json.dumps(result))
            if mode=='browser' and Path('/tmp/ixn_native_preview.json').exists():
                native=json.loads(Path('/tmp/ixn_native_preview.json').read_text())
                for a,b in zip(native['plot_year'],result['plot_year']):
                    for key in ['Load_kg_ha','WB_ETa_mm','Model_ETa_mm','Drainage_mm']:
                        assert abs(a[key]-b[key])<1e-8,(key,a[key],b[key])
            print(mode,'PASS',rows,'plots',result['daily_rows'],'daily rows',flush=True)
        # Responsive layout and keyboard-accessible input guide.
        await page.set_viewport_size(dict(width=390,height=844))
        await page.locator('[data-view="inputs"]').click()
        await page.screenshot(path='/tmp/ixn_mobile_inputs.png',full_page=True)
        assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile layout overflows'
        await page.locator('#guideLink').click() if await page.locator('#guideLink').is_visible() else None
        if await page.locator('#guideDialog').is_visible():
            await page.keyboard.press('Escape')
        assert not errors,errors
        print('BROWSER_ERRORS',errors,flush=True)
        await browser.close()


if __name__=='__main__':asyncio.run(main())
