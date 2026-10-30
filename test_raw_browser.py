"""Local QA using an intentionally small, unpublished raw-data fixture."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,args=['--no-sandbox'])
        page=await browser.new_page(viewport=dict(width=1440,height=1050))
        await page.goto('http://127.0.0.1:8766',wait_until='networkidle')
        await page.locator('[data-mode="raw"]').click()
        await page.locator('#rawFolder').set_input_files('/tmp/ixn-raw-fixture')
        await page.locator('[name=rawSite][value=Westport]').uncheck()
        await page.locator('[name=rawYear][value="2021"]').uncheck()
        await page.locator('[name=rawYear][value="2023"]').uncheck()
        await page.locator('[data-view=review]').click()
        await page.locator('#runButton').click()
        await page.wait_for_function("!document.querySelector('#resultsContent').classList.contains('hidden') || !document.querySelector('#errorPanel').classList.contains('hidden')",timeout=240000)
        error=await page.locator('#errorPanel').inner_text()
        if error:
            print('PROGRESS',await page.locator('#progressLog').inner_text(),flush=True)
            raise AssertionError(error)
        result=await page.evaluate('state.results')
        row=result['plot_year'][0]
        assert result['plot_count']==1,result['plot_count']
        for key,expected in [('Model_ETa_mm',517.0214815765762),('WB_ETa_mm',517.0214815765762),('Drainage_mm',35.46923417402249),('Load_kg_ha',1.3030529121471923)]:
            assert abs(row[key]-expected)<1e-8,(key,row[key],expected)
        await page.screenshot(path='/tmp/ixn_raw_browser_results.png',full_page=True)
        print('RAW_BROWSER_REGRESSION_PASS',row['Plot'],result['daily_rows'],flush=True)
        await browser.close()


if __name__=='__main__':asyncio.run(main())
