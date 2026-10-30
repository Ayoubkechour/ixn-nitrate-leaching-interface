/* Measured moisture stays distinct from the modeled profile and is never filled across missing samples. */
'use strict';
const PR2_SERIES = [
 ['6in_VWC %','6 in','#214e42'],['12in_VWC %','12 in','#477c70'],
 ['18in_VWC %','18 in','#8d9b57'],['24_inVWC %','24 in','#c48d4a'],
 ['36in_VWC %','36 in','#955e48']
];
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
function drawDepthReadings(rows){
 const observed=rows.filter(row=>PR2_SERIES.some(([key])=>typeof row[key]==='number'&&Number.isFinite(row[key])));
 $('depthChartCard').classList.toggle('hidden',!observed.length);
 if(!observed.length)return;
 const series=PR2_SERIES.map(([key,label,color])=>({key,label,color}));
 $('depthChartLegend').innerHTML=series.map(item=>`<span><i style="background:${item.color}"></i>${item.label}</span>`).join('');
 drawProfileChart('depthChart',observed,series,'%','No raw depth readings are available for this plot.');
}
