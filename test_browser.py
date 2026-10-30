"""End-to-end browser QA for both native and hosted/browser calculation paths.

Optional dependency: Playwright with Chromium. Start serve.py on 8765 and a
static server on 8766, then run this script. Generated artifacts go to /tmp.
"""
import asyncio
import json
import sys
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
            await page.wait_for_function("document.querySelector('#dataset').value === 'Synthetic example'")
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
            assert rows==3,(mode,rows)
            await page.locator('#chartMetric').select_option('Drainage_mm')
            assert await page.locator('#resultsTable tbody tr').count()==3
            await page.locator('#resultFilter').select_option(index=1)
            assert await page.locator('#resultsTable tbody tr').count()==3
            async with page.expect_download() as download_info:
                await page.locator('#downloadAll').click()
            download=await download_info.value
            await download.save_as(f'/tmp/ixn_{mode}_outputs.zip')
            await page.locator('[data-result-tab="quality"]').click()
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
