/* Plot selection, coverage and descriptive comparisons share the same run. */
'use strict';
Object.assign(state,{dailyCache:new Map(),dailyRequest:0,completedJob:null});
const observationView=document.createElement('div');
observationView.id='results-observations';
observationView.className='hidden';
document.querySelector('#results-comparison').after(observationView);
observationView.append(document.querySelector('#nitrateChart').closest('.card'),document.querySelector('#storageChart').closest('.card'),$('depthChartCard'));
const dataView=$('results-quality');
dataView.id='results-data';
dataView.prepend($('plotChart').closest('.card'),$('resultsTable').closest('.card'));
const plotSelectorRow=document.createElement('div');
plotSelectorRow.id='plotSelectorRow';
plotSelectorRow.className='plot-selector-row hidden';
plotSelectorRow.innerHTML='<div><strong>Explore one plot</strong><span>Change the plot to update ET, nitrate and soil observations together.</span></div>';
plotSelectorRow.append($('dailyPlot').parentElement);
document.querySelector('.result-filters').after(plotSelectorRow);
const axisControls=document.createElement('div');
axisControls.className='axis-controls';
axisControls.innerHTML='<label>X axis<select id="chartX" aria-label="X axis"><option value="Plot">Plot</option><option value="Irrigation_treatment">Irrigation treatment</option><option value="Nitrogen_treatment">Nitrogen treatment</option><option value="Year">Year</option><option value="Rain_mm">Rainfall · mm</option><option value="Irrigation_mm">Irrigation · mm</option><option value="Model_ETa_mm">Modeled ET · mm</option><option value="Drainage_mm">Drainage · mm</option><option value="WB_days">Measured WB days</option></select></label>';
const chartY=$('chartMetric');
chartY.parentElement.append(axisControls);
axisControls.append(chartY);
const yLabel=document.createElement('label');
yLabel.textContent='Y axis';
axisControls.insertBefore(yLabel,chartY);
yLabel.append(chartY);
const chartContext=document.createElement('p');
chartContext.id='chartContext';
chartContext.className='chart-context';
$('plotChart').before(chartContext);
const identityKey=row=>JSON.stringify([row.Dataset,row.Site,row.Year,row.Plot]);
const finiteValue=value=>typeof value==='number'&&Number.isFinite(value);
function drawXYChart(rows){
 const xKey=$('chartX').value,yKey=$('chartMetric').value,target=$('plotChart');
 const xLabel=$('chartX').selectedOptions[0].text,yLabel=$('chartMetric').selectedOptions[0].text;
 const valid=rows.filter(row=>finiteValue(row[yKey])&&(xKey==='Plot'||['Irrigation_treatment','Nitrogen_treatment','Year'].includes(xKey)||finiteValue(row[xKey])));
 const omitted=rows.length-valid.length;
 $('chartContext').textContent=`${xLabel} × ${yLabel} · ${valid.length} of ${rows.length} plot-year rows shown${omitted?` · ${omitted} with missing values excluded`:''}. ${['Plot','Irrigation_treatment','Nitrogen_treatment','Year'].includes(xKey)?'Categorical values are means where grouped; n is shown in tooltips.':'Each point is one plot-year; color denotes irrigation treatment.'}`;
 if(!valid.length){target.innerHTML='<div class="chart-empty">No complete X/Y pairs match these filters. Missing values are not plotted as zero.</div>';return;}
 const categorical=['Plot','Irrigation_treatment','Nitrogen_treatment','Year'].includes(xKey);
 const groups=new Map();
 if(categorical)for(const row of valid){const label=xKey==='Plot'?`${row.Plot}`:String(row[xKey]);const key=xKey==='Plot'?`${row.Dataset} / ${row.Site} / ${row.Year} / ${label}`:label;if(!groups.has(key))groups.set(key,{label,values:[],rows:[]});const group=groups.get(key);group.values.push(row[yKey]);group.rows.push(row);}
 const data=categorical?[...groups.values()].map(g=>({...g,value:g.values.reduce((a,b)=>a+b,0)/g.values.length})).sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true})):valid;
 const w=Math.max(820,categorical?data.length*15+110:820),h=320,left=70,right=25,top=32,bottom=266;
 const yMin=Math.min(0,...data.map(d=>categorical?d.value:d[yKey])),yMax=Math.max(0,...data.map(d=>categorical?d.value:d[yKey]));
 const yRange=yMax-yMin||1,y=v=>bottom-(v-yMin)/yRange*(bottom-top);
 const xValues=categorical?[]:data.map(row=>row[xKey]);const xMin=categorical?0:Math.min(...xValues),xMax=categorical?1:Math.max(...xValues),xRange=xMax-xMin||1;
 const x=v=>left+((v-xMin)/xRange)*(w-left-right);
 const palette={I1:'#6d001f',I2:'#a65a43',I3:'#956e34',I4:'#718072'};
 let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(yLabel)} by ${esc(xLabel)}"><title>${esc(yLabel)} by ${esc(xLabel)}</title><text x="${left}" y="17" class="axis-unit">${esc(yLabel)}</text>`;
 for(let t=0;t<=4;t++){const value=yMin+(yMax-yMin)*t/4;svg+=`<line x1="${left}" y1="${y(value)}" x2="${w-right}" y2="${y(value)}" stroke="#eee7e2"/><text x="${left-9}" y="${y(value)+4}" text-anchor="end">${number(value,1)}</text>`;}
 if(categorical){
  const step=(w-left-right)/data.length,bw=Math.max(3,Math.min(34,step*.7));
  data.forEach((d,i)=>{const cx=left+(i+.5)*step,barY=y(d.value),zero=y(0),fill=xKey==='Plot'?(palette[d.rows[0].Irrigation_treatment]||'#6d001f'):'#8b3851';svg+=`<rect x="${cx-bw/2}" y="${Math.min(barY,zero)}" width="${bw}" height="${Math.max(1,Math.abs(barY-zero))}" rx="2" fill="${fill}"><title>${esc(d.label)} · mean ${number(d.value,2)} · n=${d.values.length}</title></rect>`;if(i%Math.max(1,Math.ceil(data.length/18))===0)svg+=`<text x="${cx}" y="${bottom+20}" text-anchor="middle">${esc(d.label)}</text>`;});
 }else{
  for(let t=0;t<=4;t++){const value=xMin+(xMax-xMin)*t/4;svg+=`<line x1="${x(value)}" y1="${top}" x2="${x(value)}" y2="${bottom}" stroke="#f5f0ec"/><text x="${x(value)}" y="${bottom+20}" text-anchor="middle">${number(value,1)}</text>`;}
  for(const row of data){const color=palette[row.Irrigation_treatment]||'#6d001f';svg+=`<circle cx="${x(row[xKey])}" cy="${y(row[yKey])}" r="4.4" fill="${color}" fill-opacity=".77" stroke="#fff" stroke-width="1"><title>${esc(row.Site)} ${row.Year} plot ${esc(row.Plot)} · ${xLabel}: ${number(row[xKey],2)} · ${yLabel}: ${number(row[yKey],2)}</title></circle>`;}
 }
 svg+=`<text x="${(w+left-right)/2}" y="${h-9}" text-anchor="middle">${esc(xLabel)}</text></svg>`;
 const treatments=[...new Set(valid.map(row=>String(row.Irrigation_treatment)))].sort();
 const legend=xKey==='Plot'||!categorical?`<div class="chart-key"><span>Irrigation treatment</span>${treatments.map(label=>`<span><i style="background:${palette[label]||'#6d001f'}"></i>${esc(label)}</span>`).join('')}</div>`:'';
 target.innerHTML=legend+svg;
}
$('chartX').onchange=()=>state.results&&drawXYChart(filteredRows());
function csvDownload(key,rows){
 const columns=Object.keys(rows[0]||{}),quote=v=>`"${String(v??'').replace(/"/g,'""')}"`;
 const lines=[columns.map(quote).join(','),...rows.map(row=>columns.map(c=>quote(row[c])).join(','))];
 addDownload(key,'\uFEFF'+lines.join('\r\n'),'text/csv;charset=utf-8');
}
function resetExplorer(data){
 state.dailyRequest++;state.dailyCache=new Map([[String(data.daily_id),data.daily]]);
 for(const [id,key] of [['irrigationFilter','Irrigation_treatment'],['nitrogenFilter','Nitrogen_treatment']]){
  const values=[...new Set(data.plot_year.map(row=>String(row[key])))].sort();
  $(id).innerHTML='<option value="all">All treatments</option>'+values.map(value=>`<option>${esc(value)}</option>`).join('');
 }
 $('comparisonMetric').innerHTML=$('chartMetric').innerHTML;
 $('comparisonMetric').value='Model_ETa_mm';
 $('dailyPlot').innerHTML='';
}
function renderExplorer(rows){
 const days=rows.reduce((sum,row)=>sum+row.Days,0);
 const coverage=key=>days?100*rows.reduce((sum,row)=>sum+(row[key]||0),0)/days:null;
 const missing=rows.filter(row=>!finiteValue(row.Load_kg_ha)).length;
 $('coverageNote').textContent=rows.length?`${rows.length} plot-year rows · nitrate intervals cover ${number(coverage('Leaching_days'),1)}% of modeled plot-days · measured water balance covers ${number(coverage('WB_days'),1)}%. ${missing} rows have no load estimate. Load is limited to sampled intervals; WB_ETa includes modeled fallback outside measured coverage.`:'No plot-year rows match these filters.';
 renderComparison(rows);
 const identities=new Set(rows.map(identityKey));
 const available=state.results.daily_plots.filter(row=>identities.has(identityKey(row)));
 const selected=$('dailyPlot').value;
 $('dailyPlot').innerHTML=available.map(row=>`<option value="${esc(row.id)}">${esc(row.Site)} ${row.Year} · plot ${esc(row.Plot)} · ${esc(row.Dataset)}</option>`).join('');
 if(available.some(row=>String(row.id)===selected))$('dailyPlot').value=selected;
 else if(available.some(row=>String(row.id)===String(state.results.daily_id)))$('dailyPlot').value=String(state.results.daily_id);
 updateDailyPlot();
}
function comparisonRows(rows,metric,byYear){
 const groups=new Map();
 for(const row of rows){
  const labels={Dataset:row.Dataset,Site:row.Site,Year:row.Year};
  if(!byYear)Object.assign(labels,{Irrigation:row.Irrigation_treatment,Nitrogen:row.Nitrogen_treatment});
  const key=JSON.stringify(labels);
  if(!groups.has(key))groups.set(key,{labels,rows:[]});
  groups.get(key).rows.push(row);
 }
 return [...groups.values()].map(group=>{
  const values=group.rows.map(row=>row[metric]).filter(finiteValue),n=values.length;
  const mean=n?values.reduce((a,b)=>a+b,0)/n:null;
  const sd=n>1?Math.sqrt(values.reduce((sum,v)=>sum+(v-mean)**2,0)/(n-1)):null;
  return {...group.labels,Metric:metric,Plot_years:group.rows.length,n,Missing:group.rows.length-n,Mean:mean,SD:sd,Minimum:n?Math.min(...values):null,Maximum:n?Math.max(...values):null};
 }).sort((a,b)=>JSON.stringify([a.Dataset,a.Site,a.Year,a.Irrigation,a.Nitrogen]).localeCompare(JSON.stringify([b.Dataset,b.Site,b.Year,b.Irrigation,b.Nitrogen]),undefined,{numeric:true}));
}
function renderComparison(rows=filteredRows()){
 const metric=$('comparisonMetric').value;
 const records=comparisonRows(rows,metric,$('comparisonGroup').value==='years');
 renderTreatmentMatrix(rows,metric);
 const columns=Object.keys(records[0]||{}).filter(key=>key!=='Metric');
 const numeric=new Set(['Mean','SD','Minimum','Maximum']);
 $('comparisonTable').innerHTML=records.length?`<thead><tr>${columns.map(key=>`<th>${esc(key.replace(/_/g,' '))}</th>`).join('')}</tr></thead><tbody>${records.map(row=>`<tr>${columns.map(key=>`<td>${numeric.has(key)?number(row[key]):esc(row[key])}</td>`).join('')}</tr>`).join('')}</tbody>`:'<tbody><tr><td>No rows match these filters.</td></tr></tbody>';
 csvDownload('comparison',records);
}
const treatmentMatrix=document.createElement('div');
treatmentMatrix.id='comparisonMatrix';
document.querySelector('#results-comparison .table-scroll').before(treatmentMatrix);
const siteETMatrix=document.createElement('div');
siteETMatrix.id='siteETMatrix';
siteETMatrix.className='card';
document.querySelector('#results-plots').append(siteETMatrix);
function renderTreatmentMatrix(rows,metric,target=treatmentMatrix,asSiteOverview=false){
 if((!asSiteOverview&&$('comparisonGroup').value!=='treatments')||!rows.length){target.innerHTML='';target.classList.toggle('hidden',asSiteOverview);return;}
 target.classList.remove('hidden');
 const siteYears=[...new Set(rows.map(row=>`${row.Dataset} / ${row.Site} / ${row.Year}`))];
 if(siteYears.length!==1){target.innerHTML='<div class="matrix-notice">Select one site / year to view the treatment matrix.</div>';return;}
 const irrigation=[...new Set(rows.map(row=>String(row.Irrigation_treatment)))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 const nitrogen=[...new Set(rows.map(row=>String(row.Nitrogen_treatment)))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
 const cells=new Map();
 for(const i of irrigation)for(const n of nitrogen){
  const values=rows.filter(row=>String(row.Irrigation_treatment)===i&&String(row.Nitrogen_treatment)===n).map(row=>row[metric]).filter(finiteValue);
  cells.set(JSON.stringify([i,n]),{mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,n:values.length});
 }
 const available=[...cells.values()].map(cell=>cell.mean).filter(finiteValue);
 const low=Math.min(...available),high=Math.max(...available);
 const color=value=>{const fraction=high===low?.55:(value-low)/(high-low);return `hsl(345 36% ${Math.round(96-55*fraction)}%)`;};
 const header=nitrogen.map(n=>`<th scope="col">${esc(n)}</th>`).join('');
 const body=irrigation.map(i=>`<tr><th scope="row">${esc(i)}</th>${nitrogen.map(n=>{
  const cell=cells.get(JSON.stringify([i,n]));
  return `<td class="matrix-cell" ${cell.n?`style="background:${color(cell.mean)}"`:''} title="${esc(i)} × ${esc(n)} · ${cell.n?`${number(cell.mean,2)} · n=${cell.n}`:'No observations'}">${cell.n?`<strong>${number(cell.mean,1)}</strong><small>n = ${cell.n}</small>`:'<span>—</span>'}</td>`;
 }).join('')}</tr>`).join('');
 const label=asSiteOverview?'Modeled ET · mm':$('comparisonMetric').selectedOptions[0].text;
 target.innerHTML=`<div class="matrix-heading"><div><strong>${asSiteOverview?'Site-year ET across all plots':'Treatment pattern'} · ${esc(siteYears[0])}</strong><span>${esc(label)} · mean across plots; descriptive only</span></div><span>Rows: irrigation · columns: nitrogen</span></div><div class="matrix-scroll"><table><thead><tr><th scope="col">Irrigation</th>${header}</tr></thead><tbody>${body}</tbody></table></div><div class="matrix-footnote">Cell shading is relative to this selected site/year and metric. Missing values stay blank; n counts plots with a value.</div>`;
}
function displayDaily(rows,metadata){
 $('dailyTitle').textContent=`Daily water budget · ${metadata.Site} ${metadata.Year} · plot ${metadata.Plot}`;
 const summary=state.results.plot_year.find(row=>identityKey(row)===identityKey(metadata));
 $('dailyCoverage').textContent=summary?`${summary.Days} model days · ${summary.WB_days} days with measured WB · ${summary.Leaching_days} days covered by nitrate sample intervals. WB source: ${summary.WB_ETa_source.replace(/_/g,' ')}.`:'';
 drawDaily(rows);
 drawET(rows);
 drawNitrate(rows);
 drawStorage(rows);
 drawDepthReadings(rows);
}
async function updateDailyPlot(){
 const id=$('dailyPlot').value,request=++state.dailyRequest;
 const metadata=state.results?.daily_plots.find(row=>String(row.id)===id);
 if(!metadata){$('dailyTitle').textContent='Daily water budget';$('dailyChart').innerHTML='<div class="chart-empty">No plots match these filters.</div>';$('dailyCoverage').textContent='';return;}
 if(state.dailyCache.has(id)){displayDaily(state.dailyCache.get(id),metadata);return;}
 $('dailyChart').innerHTML='<div class="chart-empty" role="status">Loading selected plot…</div>';
 try{
  if(state.local){
   const response=await fetch(`/api/jobs/${state.completedJob}/files/daily_previews/${id}.json`);
   if(!response.ok)throw Error('Daily records could not be loaded. Try selecting the plot again.');
   receiveDaily({type:'daily',id,request,rows:await response.json()});
  }else state.worker.postMessage({type:'daily',id,request});
 }catch(error){receiveDaily({type:'daily_error',request,message:error.message});}
}
function receiveDaily(message){
 if(message.request!==state.dailyRequest||!state.results)return;
 if(message.type==='daily_error'){$('dailyChart').innerHTML=`<div class="chart-empty" role="alert">${esc(message.message)}</div>`;return;}
 const metadata=state.results.daily_plots.find(row=>String(row.id)===String(message.id));
 if(!metadata)return;
 state.dailyCache.set(String(message.id),message.rows);displayDaily(message.rows,metadata);
}
$('dailyPlot').onchange=updateDailyPlot;
$('irrigationFilter').onchange=renderResults;$('nitrogenFilter').onchange=renderResults;
$('comparisonMetric').onchange=()=>renderComparison();$('comparisonGroup').onchange=()=>renderComparison();
$('downloadComparison').onclick=()=>download('comparison','ixn_comparison.csv');
