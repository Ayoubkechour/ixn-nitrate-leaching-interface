/* Plot selection, coverage and descriptive comparisons share the same run. */
'use strict';
Object.assign(state,{dailyCache:new Map(),dailyRequest:0,completedJob:null});
const identityKey=row=>JSON.stringify([row.Dataset,row.Site,row.Year,row.Plot]);
const finiteValue=value=>typeof value==='number'&&Number.isFinite(value);
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
document.querySelector('#results-plots > .card').before(siteETMatrix);
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
 const color=value=>{const fraction=high===low?.55:(value-low)/(high-low);return `hsl(153 28% ${Math.round(95-43*fraction)}%)`;};
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
