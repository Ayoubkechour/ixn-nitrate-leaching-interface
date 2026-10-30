/* Measured moisture stays distinct from the modeled profile and is never filled across missing samples. */
'use strict';
const PR2_SERIES = [
 ['6in_VWC %','6 in','#214e42'],['12in_VWC %','12 in','#477c70'],
 ['18in_VWC %','18 in','#8d9b57'],['24_inVWC %','24 in','#c48d4a'],
 ['36in_VWC %','36 in','#955e48']
];
let depthRows=[];
let depthView='matrix';
let depthMetadata=null;
const nitrateCard=document.createElement('div');
nitrateCard.className='card';
nitrateCard.innerHTML='<div class="card-title"><div><h2 id="nitrateChartTitle">Sampled nitrate concentration</h2><p id="nitrateChartNote">Each point is a measured sample date. Gaps are left unfilled.</p></div></div><div id="nitrateChart" class="chart"></div><div class="table-scroll nitrate-sample-scroll"><table id="nitrateSamplesTable" aria-label="Measured nitrate sample values"></table></div>';
document.querySelector('#results-daily > .card').insertAdjacentElement('afterend',nitrateCard);
let etRows=[];
let etView='monthly';
const etCard=document.createElement('div');
etCard.className='card';
etCard.innerHTML='<div class="card-title"><div><h2>Evapotranspiration through the season</h2><p>IXN modeled actual ET and weather-derived reference ET. Monthly totals include only analyzed days.</p></div><div class="depth-controls"><button type="button" data-et-view="monthly" class="selected">Monthly</button><button type="button" data-et-view="cumulative">Cumulative</button></div></div><div id="etTotals" class="water-totals"></div><div class="chart-legend"><span><i style="background:#3a7863"></i>Modeled actual ET</span><span><i style="background:#8aa6a0"></i>Reference ET</span></div><div id="etChart" class="chart"></div><p class="result-footnote">One plot is shown (n = 1 per monthly total); replicate SD is not estimable here. Overview and grouped comparisons show mean ±1 SD across selected plots. These are IXN estimates from supplied weather and model settings, not OpenET satellite ET.</p>';
document.querySelector('#results-daily > .card').insertAdjacentElement('afterend',etCard);
etCard.querySelectorAll('[data-et-view]').forEach(button=>button.onclick=()=>{
 etView=button.dataset.etView;
 etCard.querySelectorAll('[data-et-view]').forEach(item=>item.classList.toggle('selected',item===button));
 renderET();
});
const depthControls=document.createElement('div');
depthControls.className='depth-controls';
depthControls.innerHTML='<button type="button" data-depth-view="matrix" class="selected">Depth × date</button><button type="button" data-depth-view="lines">Depth lines</button>';
document.querySelector('#depthChartCard .card-title').append(depthControls);
depthControls.querySelectorAll('button').forEach(button=>button.onclick=()=>{
 depthView=button.dataset.depthView;
 depthControls.querySelectorAll('button').forEach(item=>item.classList.toggle('selected',item===button));
 renderDepthReadings();
});
function observationUnion(daily,observations){
 if(!Array.isArray(observations))return daily;
 const merged=new Map();
 for(const row of daily){const date=String(row.Date).slice(0,10);merged.set(date,{...row,Date:date});}
 for(const row of observations){
  const date=String(row.Date).slice(0,10),record=merged.get(date)||{Date:date};
  for(const key of ['Nitrate_mg_L','Observed_storage_mm',...PR2_SERIES.map(([field])=>field)])if(Object.prototype.hasOwnProperty.call(row,key))record[key]=row[key];
  merged.set(date,record);
 }
 return [...merged.values()].sort((a,b)=>String(a.Date).localeCompare(String(b.Date)));
}
function drawProfileChart(target, rows, series, unit, emptyMessage, modelRange) {
 const available = series.flatMap(item => rows.map(row => row[item.key])).filter(value => typeof value === 'number' && Number.isFinite(value));
 if (!available.length) { $(target).innerHTML = `<div class="chart-empty">${esc(emptyMessage)}</div>`; return; }
 const width=880,height=280,left=58,right=18,top=20,bottom=239;
 const rawMin=Math.min(...available),rawMax=Math.max(...available);
 const padding=Math.max((rawMax-rawMin)*.12,unit==='%'?2:5);
 const floor=Math.max(0,rawMin-padding),ceiling=rawMax+padding;
 const stamps=rows.map(row=>Date.parse(String(row.Date).slice(0,10)+'T00:00:00Z'));
 const dated=stamps.every(Number.isFinite),first=dated?Math.min(...stamps):0,last=dated?Math.max(...stamps):0;
 const x=index=>dated&&last>first?left+(stamps[index]-first)/(last-first)*(width-left-right):left+index*(width-left-right)/Math.max(1,rows.length-1);
 const y=value=>bottom-(value-floor)/(ceiling-floor)*(bottom-top);
 let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(series.map(item=>item.label).join(', '))} by date in ${unit}"><title>${esc(series.map(item=>item.label).join(', '))} · ${unit}</title>`;
 if(modelRange&&dated&&last>first){
  const at=time=>left+(time-first)/(last-first)*(width-left-right);
  const from=Math.max(left,at(Date.parse(modelRange[0]+'T00:00:00Z'))),to=Math.min(width-right,at(Date.parse(modelRange[1]+'T00:00:00Z')));
  if(to>=from)svg+=`<rect x="${from}" y="${top}" width="${Math.max(1,to-from)}" height="${bottom-top}" fill="#f8f1eb"/><line x1="${from}" x2="${from}" y1="${top}" y2="${bottom}" stroke="#c4a79a" stroke-dasharray="4 4"/><line x1="${to}" x2="${to}" y1="${top}" y2="${bottom}" stroke="#c4a79a" stroke-dasharray="4 4"/>`;
 }
 for(let tick=0;tick<=4;tick++){
  const value=floor+(ceiling-floor)*tick/4,cy=y(value);
  svg+=`<line x1="${left}" y1="${cy}" x2="${width-right}" y2="${cy}" stroke="#e5ece5"/><text x="${left-9}" y="${cy+4}" text-anchor="end">${number(value,unit==='%'?1:0)}</text>`;
 }
 svg+=`<line x1="${left}" y1="${bottom}" x2="${width-right}" y2="${bottom}" stroke="#aebdb1"/><text x="${left}" y="12" class="axis-unit">${esc(unit)}</text>`;
 if(dated&&last>first){
  for(let tick=0;tick<=6;tick++){
   const time=first+(last-first)*tick/6,label=new Date(time).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
   svg+=`<text x="${left+(width-left-right)*tick/6}" y="${height-12}" text-anchor="${tick===0?'start':tick===6?'end':'middle'}">${esc(label)}</text>`;
  }
 }else for(let index=0;index<rows.length;index+=Math.max(1,Math.ceil(rows.length/7)))svg+=`<text x="${x(index)}" y="${height-12}" text-anchor="middle">${esc(String(rows[index].Date).slice(5,10))}</text>`;
 for(const item of series){
  let segment=[];
  const flush=()=>{if(segment.length>1)svg+=`<polyline fill="none" stroke="${item.color}" stroke-width="${item.scatter?0:2.3}" stroke-linecap="round" stroke-linejoin="round" points="${segment.join(' ')}"/>`;segment=[];};
  rows.forEach((row,index)=>{
   const value=row[item.key];
   if(typeof value!=='number'||!Number.isFinite(value)){if(!item.scatter)flush();return;}
   if(!item.scatter)segment.push(`${x(index)},${y(value)}`);
   if(item.scatter||rows.length<=45){
    svg+=`<circle cx="${x(index)}" cy="${y(value)}" r="${item.scatter?4.1:2.3}" fill="${item.scatter?'#fff':item.color}" stroke="${item.color}" stroke-width="${item.scatter?2.2:1}"><title>${esc(String(row.Date).slice(0,10))} · ${esc(item.label)}: ${number(value,2)} ${esc(unit)}</title></circle>`;
   }
  });
  if(!item.scatter)flush();
 }
 svg+='</svg>';
 $(target).innerHTML=svg;
}
function drawStorage(rows,metadata,summary,observations){
 const merged=observationUnion(rows,observations),dates=rows.map(row=>String(row.Date).slice(0,10)).sort();
 drawProfileChart('storageChart',merged,[
  {key:'Storage_end_mm',label:'Modeled storage',color:'#3a7863'},
  {key:'Observed_storage_mm',label:'Measured storage',color:'#c49343',scatter:true}
 ],'mm','No profile storage records are available for this plot.',dates.length?[dates[0],dates[dates.length-1]]:null);
 const measured=merged.filter(row=>Number.isFinite(row.Observed_storage_mm));
 const title=document.querySelector('#storageChart').closest('.card').querySelector('.card-title p');
 if(title)title.textContent=`${measured.length} measured storage date${measured.length===1?'':'s'}${measured.length?` · ${String(measured[0].Date).slice(0,10)}–${String(measured[measured.length-1].Date).slice(0,10)}`:''}. Shaded span is the modeled period.`;
}
function drawNitrate(rows,metadata,summary,observations){
 const source=Array.isArray(observations)?observations:rows;
 const collection=source.filter(row=>Number.isFinite(Date.parse(String(row.Date).slice(0,10)+'T00:00:00Z'))&&(row.Nitrate_source||row.Nitrate_status||Number(row.Nitrate_sample_count)>0||Number.isFinite(row.Nitrate_mg_L))).sort((a,b)=>String(a.Date).localeCompare(String(b.Date)));
 const samples=collection.filter(row=>typeof row.Nitrate_mg_L==='number'&&Number.isFinite(row.Nitrate_mg_L)&&row.Nitrate_mg_L>=0);
 const basis=$('nitrate_basis').value;
 const analyte=basis==='NO3-N'?'NO₃-N':basis==='NO3'?'NO₃':'reported analyte';
 const identity=metadata?`${metadata.Site} ${metadata.Year} · plot ${metadata.Plot}`:'selected plot';
 $('nitrateChartTitle').textContent=`Sampled nitrate concentration · ${identity}`;
 const day=value=>String(value).slice(0,10);
 const modelDates=rows.map(row=>day(row.Date)).filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
 const modelStart=modelDates[0],modelEnd=modelDates[modelDates.length-1];
 const outside=collection.filter(row=>modelStart&&(day(row.Date)<modelStart||day(row.Date)>modelEnd)).length;
 const sampleSpan=collection.length?`${day(collection[0].Date)}–${day(collection[collection.length-1].Date)}`:'no collection dates';
 $('nitrateChartNote').textContent=`${collection.length} collection date${collection.length===1?'':'s'} (${sampleSpan}) · ${samples.length} valid ${analyte} point${samples.length===1?'':'s'} · mg/L. ${outside} collection date${outside===1?'':'s'} outside the modeled period. Invalid or censored values stay in the table; no interpolation.`;
 $('nitrateSamplesTable').innerHTML=collection.length?`<thead><tr><th>Collection date</th><th>Original as reported</th><th>Valid ${esc(analyte)} · mg/L</th><th>Status / source</th><th>In model period</th><th>n</th></tr></thead><tbody>${collection.map(row=>{const date=day(row.Date),inside=modelStart&&date>=modelStart&&date<=modelEnd;const valid=typeof row.Nitrate_mg_L==='number'&&Number.isFinite(row.Nitrate_mg_L)&&row.Nitrate_mg_L>=0;const status=row.Nitrate_status||row.Nitrate_source||'Recorded';return `<tr><td>${esc(date)}</td><td>${esc(row.Nitrate_original_value)}</td><td>${valid?number(row.Nitrate_mg_L,3):'—'}</td><td title="${esc(row.Nitrate_source)}">${esc(status)}</td><td>${inside?'Yes':'No'}</td><td>${Number.isFinite(row.Nitrate_sample_count)?row.Nitrate_sample_count:'—'}</td></tr>`;}).join('')}</tbody>`:'<tbody><tr><td>No nitrate collection records for this plot.</td></tr></tbody>';
 if(!samples.length){$('nitrateChart').innerHTML='<div class="chart-empty">No valid nitrate concentrations are available for this plot. Collection dates and statuses are listed below.</div>';return;}
 const stamp=value=>Date.parse(day(value)+'T00:00:00Z');
 const allDates=[...collection.map(row=>stamp(row.Date)),...modelDates.map(stamp)];
 const dayMs=86400000,start=Math.min(...allDates),end=Math.max(...allDates),domainEnd=end===start?end+dayMs:end;
 const width=900,height=284,left=64,right=20,top=25,bottom=236,plotWidth=width-left-right;
 const x=time=>left+(time-start)/(domainEnd-start)*plotWidth;
 const max=Math.max(1,...samples.map(row=>row.Nitrate_mg_L))*1.12;
 const y=value=>bottom-value/max*(bottom-top);
 let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Measured ${esc(analyte)} concentration for ${esc(identity)} across all sampled dates"><title>${esc(identity)} · ${samples.length} measured nitrate dates · ${esc(sampleSpan)}</title><desc>Points are observed concentrations. The shaded area is the modeled analysis period; points beyond it are still shown.</desc>`;
 if(modelStart){
  const x0=x(stamp(modelStart)),x1=x(stamp(modelEnd));
  svg+=`<rect x="${x0}" y="${top}" width="${Math.max(1,x1-x0)}" height="${bottom-top}" fill="#f8f1eb"/><line x1="${x0}" x2="${x0}" y1="${top}" y2="${bottom}" stroke="#c4a79a" stroke-dasharray="4 4"/><line x1="${x1}" x2="${x1}" y1="${top}" y2="${bottom}" stroke="#c4a79a" stroke-dasharray="4 4"/><text x="${Math.max(left+4,x0+5)}" y="${top+14}" fill="#9a7469">Modeled period</text>`;
 }
 for(let tick=0;tick<=4;tick++){
  const value=max*tick/4,at=y(value);
  svg+=`<line x1="${left}" x2="${width-right}" y1="${at}" y2="${at}" stroke="#e7dfda"/><text x="${left-11}" y="${at+4}" text-anchor="end">${number(value,max<10?1:0)}</text>`;
 }
 svg+=`<text x="${left}" y="14" class="axis-unit">mg/L</text>`;
 const ticks=6;for(let tick=0;tick<=ticks;tick++){
  const time=start+(domainEnd-start)*tick/ticks,label=new Date(time).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:'UTC'});
  svg+=`<text x="${x(time)}" y="${height-15}" text-anchor="${tick===0?'start':tick===ticks?'end':'middle'}">${esc(label)}</text>`;
 }
 for(const row of samples){
  const date=day(row.Date),isOutside=modelStart&&(date<modelStart||date>modelEnd),value=row.Nitrate_mg_L;
  svg+=`<circle cx="${x(stamp(row.Date))}" cy="${y(value)}" r="4.7" fill="${isOutside?'#fff':'#9f5147'}" stroke="#9f5147" stroke-width="2"><title>${esc(date)} · ${esc(analyte)} ${number(value,2)} mg/L${isOutside?' · outside modeled period':''}</title></circle>`;
 }
 svg+='</svg>';$('nitrateChart').innerHTML=svg;
}
function drawET(rows){
 etRows=rows;
 etCard.querySelectorAll('[data-et-view]').forEach(button=>button.disabled=false);
 renderET();
}
function renderET(){
 if(!etRows.length){$('etChart').innerHTML='<div class="chart-empty">No ET records are available for this plot.</div>';$('etTotals').innerHTML='';return;}
 const sum=key=>etRows.reduce((total,row)=>total+(Number.isFinite(row[key])?row[key]:0),0);
 const actual=sum('ETa_model_mm'),reference=sum('ETo_mm');
 $('etTotals').innerHTML=`<div><span>Modeled actual ET</span><strong>${number(actual,1)} <small>mm</small></strong></div><div><span>Reference ET</span><strong>${number(reference,1)} <small>mm</small></strong></div><div><span>Actual / reference</span><strong>${reference?number(actual/reference,2):'—'}</strong></div>`;
 if(etView==='monthly')drawMonthlyET();else drawCumulativeET();
}
function drawMonthlyET(){
 const monthly=new Map();
 for(const row of etRows){
  const month=String(row.Date).slice(0,7);
  if(!monthly.has(month))monthly.set(month,{month,actual:0,reference:0});
  const item=monthly.get(month);
  item.actual+=Number.isFinite(row.ETa_model_mm)?row.ETa_model_mm:0;
  item.reference+=Number.isFinite(row.ETo_mm)?row.ETo_mm:0;
 }
 const values=[...monthly.values()],width=880,height=285,left=58,right=18,top=22,bottom=242;
 const max=Math.max(1,...values.flatMap(row=>[row.actual,row.reference]));
 const x=index=>left+(index+.5)*(width-left-right)/values.length;
 const y=value=>bottom-value/max*(bottom-top);
 let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly modeled actual and reference evapotranspiration totals in millimeters"><title>Monthly ET totals over analyzed days</title><desc>One plot-month per bar, n = 1. Replicate standard deviation is not estimable.</desc><text x="${left}" y="13" class="axis-unit">mm/month</text>`;
 for(let tick=0;tick<=4;tick++){
  const value=max*tick/4,cy=y(value);
  svg+=`<line x1="${left}" y1="${cy}" x2="${width-right}" y2="${cy}" stroke="#e5ece5"/><text x="${left-9}" y="${cy+4}" text-anchor="end">${number(value,0)}</text>`;
 }
 const groupWidth=(width-left-right)/values.length,barWidth=Math.min(34,groupWidth*.28);
 values.forEach((row,index)=>{
  const cx=x(index);
  for(const [value,shift,color,label] of [[row.actual,-barWidth-2,'#3a7863','Modeled actual ET'],[row.reference,2,'#8aa6a0','Reference ET']]){
   svg+=`<rect x="${cx+shift}" y="${y(value)}" width="${barWidth}" height="${bottom-y(value)}" rx="2" fill="${color}"><title>${esc(row.month)} · ${label}: ${number(value,1)} mm · n = 1 plot-month · SD not estimable</title></rect>`;
  }
  const month=new Date(`${row.month}-01T00:00:00Z`).toLocaleString('en-US',{month:'short',timeZone:'UTC'});
  svg+=`<text x="${cx}" y="${height-19}" text-anchor="middle">${month}</text>`;
 });
 svg+='</svg>';$('etChart').innerHTML=svg;
}
function drawCumulativeET(){
 let actual=0,reference=0;
 const series=etRows.map(row=>({Date:row.Date,actual:actual+=(Number.isFinite(row.ETa_model_mm)?row.ETa_model_mm:0),reference:reference+=(Number.isFinite(row.ETo_mm)?row.ETo_mm:0)}));
 drawProfileChart('etChart',series,[{key:'actual',label:'Cumulative modeled actual ET',color:'#3a7863'},{key:'reference',label:'Cumulative reference ET',color:'#8aa6a0'}],'mm','No ET records are available for this plot.');
}
function drawDepthReadings(rows,metadata,summary,observations){
 depthMetadata=metadata||null;
 const source=Array.isArray(observations)?observations:rows;
 depthRows=source.filter(row=>PR2_SERIES.some(([key])=>typeof row[key]==='number'&&Number.isFinite(row[key]))).slice().sort((a,b)=>String(a.Date).localeCompare(String(b.Date)));
 depthControls.querySelectorAll('button').forEach(button=>button.disabled=!depthRows.length);
 $('depthChartCard').classList.toggle('hidden',!depthRows.length);
 if(depthRows.length)renderDepthReadings();
}
window.resetPlotChartData=()=>{
 etRows=[];depthRows=[];depthMetadata=null;
 if($('nitrateSamplesTable'))$('nitrateSamplesTable').innerHTML='';
 etCard.querySelectorAll('[data-et-view]').forEach(button=>button.disabled=true);
 depthControls.querySelectorAll('button').forEach(button=>button.disabled=true);
 if(window.resetScientificExplorerData)window.resetScientificExplorerData();
};
function renderDepthReadings(){
 let invalid=0;
 const observed=depthRows.map(row=>{
  const clean={...row};
  for(const [key] of PR2_SERIES){
   if(typeof clean[key]==='number'&&Number.isFinite(clean[key])&&(clean[key]<0||clean[key]>100)){
    clean[key]=null;invalid++;
   }
  }
  return clean;
 }).filter(row=>PR2_SERIES.some(([key])=>typeof row[key]==='number'&&Number.isFinite(row[key])));
 const span=depthRows.length?`${String(depthRows[0].Date).slice(0,10)}–${String(depthRows[depthRows.length-1].Date).slice(0,10)}`:'no sampled dates';
 const outside=depthRows.filter(row=>row.In_model_period===false).length;
 const title=document.querySelector('#depthChartCard .card-title h2');
 if(depthMetadata)title.textContent=`Raw soil moisture by depth · ${depthMetadata.Site} ${depthMetadata.Year} · plot ${depthMetadata.Plot}`;
 document.querySelector('#depthChartCard .card-title p').textContent=`${depthRows.length} sampling date${depthRows.length===1?'':'s'} (${span}) · ${outside} outside modeled period · VWC %. Blank cells mean no reading. ${invalid?`${invalid} out-of-range reading${invalid===1?'':'s'} marked for review and retained in the input audit.`:'No readings outside 0–100%.'}`;
 if(depthView==='matrix'){
  const values=observed.flatMap(row=>PR2_SERIES.map(([key])=>row[key])).filter(value=>typeof value==='number'&&Number.isFinite(value));
  let low=values.length?Math.max(0,Math.floor(Math.min(...values)/5)*5):0;
  let high=values.length?Math.min(100,Math.ceil(Math.max(...values)/5)*5):100;
  if(high-low<10){low=Math.max(0,low-5);high=Math.min(100,high+5);}
  $('depthChartLegend').innerHTML=`<div class="scale-key"><span>${low}%</span><span class="scale-ramp"></span><span>${high}%</span><span class="scale-context">Selected plot scale</span><span class="key-missing"></span><span>Missing</span><span class="key-invalid"></span><span>Outside 0–100%</span></div>`;
  drawDepthMatrix(depthRows,low,high);
  return;
 }
 const series=PR2_SERIES.map(([key,label,color])=>({key,label,color}));
 $('depthChartLegend').innerHTML=series.map(item=>`<span><i style="background:${item.color}"></i>${item.label}</span>`).join('');
 drawProfileChart('depthChart',observed,series,'%','No valid raw depth readings are available for this plot.');
}
function depthColor(value,low,high){
 const stops=[[243,246,234],[185,215,186],[103,167,160],[42,105,116],[30,60,82]];
 const position=Math.max(0,Math.min(3.999,(value-low)/(high-low)*4)),index=Math.floor(position),fraction=position-index;
 return `rgb(${stops[index].map((channel,i)=>Math.round(channel+(stops[index+1][i]-channel)*fraction)).join(',')})`;
}
function drawDepthMatrix(rows,low,high){
 const left=87,top=27,cellWidth=Math.max(27,Math.min(74,Math.floor(650/rows.length))),cellHeight=34,width=Math.max(790,left+rows.length*cellWidth+25),height=266;
 let svg=`<svg viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="img" aria-label="Measured volumetric water content by sampling date and sensor depth"><title>PR2 water content by depth and date · percent</title><text x="${left}" y="14" class="axis-unit">VWC %</text>`;
 PR2_SERIES.forEach(([key,label],depth)=>{
  const cy=top+depth*cellHeight;
  svg+=`<text x="${left-12}" y="${cy+22}" text-anchor="end">${label}</text>`;
  rows.forEach((row,index)=>{
   const value=row[key],valid=typeof value==='number'&&Number.isFinite(value),outOfRange=valid&&(value<0||value>100);
   const fill=!valid?'#edf1eb':outOfRange?'#e8b89a':depthColor(value,low,high);
   const labelValue=!valid?'missing':outOfRange?`${number(value,2)}% · outside 0–100%`:`${number(value,2)}%`;
   svg+=`<rect x="${left+index*cellWidth}" y="${cy}" width="${cellWidth-1}" height="${cellHeight-2}" rx="2" fill="${fill}"><title>${esc(String(row.Date).slice(0,10))} · ${label}: ${labelValue}</title></rect>`;
  });
 });
 const every=Math.max(1,Math.ceil(rows.length/10),Math.ceil(55/cellWidth));
 rows.forEach((row,index)=>{if(index%every===0)svg+=`<text x="${left+index*cellWidth+cellWidth/2}" y="${height-28}" text-anchor="middle">${esc(String(row.Date).slice(5,10))}</text>`;});
 svg+=`<text x="${left+(rows.length*cellWidth)/2}" y="${height-5}" text-anchor="middle">Sampling date</text></svg>`;
 $('depthChart').innerHTML=svg;
}
