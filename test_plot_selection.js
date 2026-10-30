/* Regression for atomic chart updates and out-of-order lazy plot responses.
 * Older Node versions: node --harmony-optional-chaining --harmony-nullish test_plot_selection.js
 */
'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const elements=new Map();
const $=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'old plot data',textContent:'',dataset:{},attributes:{},setAttribute(k,v){this.attributes[k]=v;}});return elements.get(id);};
const identityKey=row=>JSON.stringify([row.Dataset,row.Site,row.Year,row.Plot]);
const first={id:'0',Dataset:'Study',Site:'Field',Year:2022,Plot:101};
const second={...first,id:'1',Plot:102};
const third={...first,id:'2',Plot:103};
const sample=(meta,value)=>[{...meta,Date:'2022-04-01',Nitrate_mg_L:value}];
const messages=[],drawn=[],controls=[{disabled:false},{disabled:false}];
const state={dailyRequest:0,dailyCache:new Map(),local:false,worker:{postMessage:message=>messages.push(message)},results:{daily_plots:[first,second,third],plot_year:[first,second,third].map(row=>({...row,Days:169,WB_days:0,Leaching_days:10,WB_ETa_source:'modeled_fallback'}))}};
const context={$,state,identityKey,finiteValue:v=>typeof v==='number'&&Number.isFinite(v),esc:String,number:(v,d=1)=>Number(v).toFixed(d),document:{querySelectorAll:()=>controls},window:{resetPlotChartData(){drawn.push('reset');},drawScientificExplorer(rows,metadata,summary,observations){$('scientificExplorerCard').innerHTML=String(metadata.Plot);drawn.push({plot:metadata.Plot,value:observations[0]?.Nitrate_mg_L});}},drawDaily:rows=>{$('dailyChart').innerHTML='new daily';},drawET:rows=>{$('etChart').innerHTML='new ET';},drawNitrate:(rows,metadata,summary,observations)=>{$('nitrateChart').innerHTML=String(observations[0]?.Nitrate_mg_L);},drawStorage:()=>{$('storageChart').innerHTML='new storage';},drawDepthReadings:()=>{$('depthChart').innerHTML='new depths';}};
vm.createContext(context);
const source=fs.readFileSync('dist/results_explorer.js','utf8');
vm.runInContext(source.slice(source.indexOf('function setPlotState('),source.indexOf("$('dailyPlot').onchange=")),context);
vm.runInContext(source.slice(source.indexOf('function drawXYChart('),source.indexOf("$('chartX').onchange=")),context);
const chartIds=['dailyChart','etChart','nitrateChart','storageChart','depthChart','scientificExplorerCard'];
async function main(){
 $('chartX').value='Rain_mm';$('chartX').selectedOptions=[{text:'Rainfall · mm'}];
 $('chartMetric').value='Drainage_mm';$('chartMetric').selectedOptions=[{text:'Drainage · mm'}];
 context.drawXYChart([{...first,Rain_mm:100,Drainage_mm:0,Irrigation_treatment:'I1'},{...second,Rain_mm:100,Drainage_mm:0,Irrigation_treatment:'I2'}]);
 assert($('plotChart').innerHTML.includes('cx="432.5"'),'constant numeric X should be centered on a padded domain');
 assert($('plotChart').innerHTML.includes('95.0')&&$('plotChart').innerHTML.includes('105.0'),'constant X needs distinct ticks');
 assert($('plotChart').innerHTML.includes('1.0'),'zero-only Y needs a nonzero domain');
 $('dailyPlot').value='1';await context.updateDailyPlot();
 assert(chartIds.every(id=>$(id).innerHTML.includes('plot 102')&&$(id).innerHTML.includes('Loading')));
 assert(controls.every(button=>button.disabled));
 const request=state.dailyRequest;
 context.receiveDaily({type:'daily',id:'0',request,rows:[],observations:sample(first,8)});
 assert($('nitrateChart').innerHTML.includes('Loading'),'wrong plot response must be ignored even with current token');
 context.receiveDaily({type:'daily',id:'1',request,rows:[{Date:'2022-05-16'}],observations:sample(second,42)});
 assert.equal($('nitrateChart').innerHTML,'42');assert(controls.every(button=>!button.disabled));
 assert($('plotLoadStatus').textContent.includes('2022-04-01'));
 $('dailyPlot').value='2';await context.updateDailyPlot();const olderRequest=state.dailyRequest;
 $('dailyPlot').value='1';await context.updateDailyPlot();
 context.receiveDaily({type:'daily',id:'2',request:olderRequest,rows:[],observations:sample(third,99)});
 assert.equal($('nitrateChart').innerHTML,'42','late response must not replace cached selected plot');
 $('dailyPlot').value='2';await context.updateDailyPlot();
 context.receiveDaily({type:'daily_error',id:'2',request:state.dailyRequest,message:'Cannot load this plot'});
 assert(chartIds.every(id=>$(id).innerHTML.includes('Cannot load this plot')));
 assert(controls.every(button=>button.disabled));
 await context.updateDailyPlot();
 context.receiveDaily({type:'daily',id:'2',request:state.dailyRequest,rows:[],observations:sample(first,8)});
 assert(chartIds.every(id=>$(id).innerHTML.includes('do not match')),'wrong observation identity must be rejected');
 $('dailyPlot').value='';await context.updateDailyPlot();
 assert(chartIds.every(id=>$(id).innerHTML.includes('No plots match')));
 console.log('Plot selection regression passed: loading, cached switch, late replies, failures, identity mismatch, empty filters and constant numeric axes.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
