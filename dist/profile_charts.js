/* Measured moisture stays distinct from the modeled profile and is never filled across missing samples. */
'use strict';
const PR2_SERIES = [
 ['6in_VWC %','6 in','#214e42'],['12in_VWC %','12 in','#477c70'],
 ['18in_VWC %','18 in','#8d9b57'],['24_inVWC %','24 in','#c48d4a'],
 ['36in_VWC %','36 in','#955e48']
];
let depthRows=[];
let depthView='matrix';
const nitrateCard=document.createElement('div');
nitrateCard.className='card';
nitrateCard.innerHTML='<div class="card-title"><div><h2>Sampled nitrate concentration</h2><p id="nitrateChartNote">Each point is a measured sample date. Gaps are left unfilled.</p></div></div><div id="nitrateChart" class="chart"></div>';
document.querySelector('#results-daily > .card').insertAdjacentElement('afterend',nitrateCard);
let etRows=[];
let etView='monthly';
const etCard=document.createElement('div');
etCard.className='card';
etCard.innerHTML='<div class="card-title"><div><h2>Evapotranspiration through the season</h2><p>IXN modeled actual ET and weather-derived reference ET. Monthly totals include only analyzed days.</p></div><div class="depth-controls"><button type="button" data-et-view="monthly" class="selected">Monthly</button><button type="button" data-et-view="cumulative">Cumulative</button></div></div><div id="etTotals" class="water-totals"></div><div class="chart-legend"><span><i style="background:#3a7863"></i>Modeled actual ET</span><span><i style="background:#8aa6a0"></i>Reference ET</span></div><div id="etChart" class="chart"></div><p class="result-footnote">These are IXN estimates from supplied weather and model settings, not OpenET satellite ET.</p>';
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
function drawProfileChart(target, rows, series, unit, emptyMessage) {
 const available = series.flatMap(item => rows.map(row => row[item.key])).filter(value => typeof value === 'number' && Number.isFinite(value));
 if (!available.length) { $(target).innerHTML = `<div class="chart-empty">${esc(emptyMessage)}</div>`; return; }
 const width=880,height=280,left=58,right=18,top=20,bottom=239;
 const rawMin=Math.min(...available),rawMax=Math.max(...available);
 const padding=Math.max((rawMax-rawMin)*.12,unit==='%'?2:5);
 const floor=Math.max(0,rawMin-padding),ceiling=rawMax+padding;
 const x=index=>left+index*(width-left-right)/Math.max(1,rows.length-1);
 const y=value=>bottom-(value-floor)/(ceiling-floor)*(bottom-top);
 let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(series.map(item=>item.label).join(', '))} by date in ${unit}"><title>${esc(series.map(item=>item.label).join(', '))} · ${unit}</title>`;
 for(let tick=0;tick<=4;tick++){
  const value=floor+(ceiling-floor)*tick/4,cy=y(value);
  svg+=`<line x1="${left}" y1="${cy}" x2="${width-right}" y2="${cy}" stroke="#e5ece5"/><text x="${left-9}" y="${cy+4}" text-anchor="end">${number(value,unit==='%'?1:0)}</text>`;
 }
 svg+=`<line x1="${left}" y1="${bottom}" x2="${width-right}" y2="${bottom}" stroke="#aebdb1"/><text x="${left}" y="12" class="axis-unit">${esc(unit)}</text>`;
 for(let index=0;index<rows.length;index+=Math.max(1,Math.ceil(rows.length/7))){
  svg+=`<text x="${x(index)}" y="${height-12}" text-anchor="middle">${esc(String(rows[index].Date).slice(5,10))}</text>`;
 }
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
function drawStorage(rows){
 drawProfileChart('storageChart',rows,[
  {key:'Storage_end_mm',label:'Modeled storage',color:'#3a7863'},
  {key:'Observed_storage_mm',label:'Measured storage',color:'#c49343',scatter:true}
 ],'mm','No profile storage records are available for this plot.');
}
function drawNitrate(rows){
 const samples=rows.filter(row=>typeof row.Nitrate_mg_L==='number'&&Number.isFinite(row.Nitrate_mg_L));
 const basis=$('nitrate_basis').value;
 const analyte=basis==='NO3-N'?'NO₃-N':basis==='NO3'?'NO₃':'reported analyte';
 $('nitrateChartNote').textContent=`${samples.length} measured sample date${samples.length===1?'':'s'} · ${analyte} · mg/L. Points show observations; missing dates are not interpolated in this chart.`;
 drawProfileChart('nitrateChart',rows,[{key:'Nitrate_mg_L',label:'Measured concentration',color:'#955e48',scatter:true}],'mg/L','No valid nitrate samples are available for this plot.');
}
function drawET(rows){
 etRows=rows;
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
 let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly modeled actual and reference evapotranspiration totals in millimeters"><title>Monthly ET totals over analyzed days</title><text x="${left}" y="13" class="axis-unit">mm/month</text>`;
 for(let tick=0;tick<=4;tick++){
  const value=max*tick/4,cy=y(value);
  svg+=`<line x1="${left}" y1="${cy}" x2="${width-right}" y2="${cy}" stroke="#e5ece5"/><text x="${left-9}" y="${cy+4}" text-anchor="end">${number(value,0)}</text>`;
 }
 const groupWidth=(width-left-right)/values.length,barWidth=Math.min(34,groupWidth*.28);
 values.forEach((row,index)=>{
  const cx=x(index);
  for(const [value,shift,color,label] of [[row.actual,-barWidth-2,'#3a7863','Modeled actual ET'],[row.reference,2,'#8aa6a0','Reference ET']]){
   svg+=`<rect x="${cx+shift}" y="${y(value)}" width="${barWidth}" height="${bottom-y(value)}" rx="2" fill="${color}"><title>${esc(row.month)} · ${label}: ${number(value,1)} mm</title></rect>`;
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
function drawDepthReadings(rows){
 depthRows=rows.filter(row=>PR2_SERIES.some(([key])=>typeof row[key]==='number'&&Number.isFinite(row[key])));
 $('depthChartCard').classList.toggle('hidden',!depthRows.length);
 if(depthRows.length)renderDepthReadings();
}
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
 document.querySelector('#depthChartCard .card-title p').textContent=`${depthRows.length} sampling date${depthRows.length===1?'':'s'} · VWC %. Blank cells mean no reading. ${invalid?`${invalid} out-of-range reading${invalid===1?'':'s'} marked for review and retained in the input audit.`:'No readings outside 0–100%.'}`;
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
