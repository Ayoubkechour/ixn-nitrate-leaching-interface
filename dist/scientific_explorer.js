/* Linked field timeline: daily fluxes, sampled nitrate and raw PR2 depths. */
'use strict';
(() => {
 const series=[
  {key:'Rain_mm',label:'Rain',unit:'mm/day',panel:'water',color:'#83A9BE',mark:'bar'},
  {key:'Irrigation_mm',label:'Irrigation',unit:'mm/day',panel:'water',color:'#5B8B75',mark:'bar'},
  {key:'ETa_model_mm',label:'Modeled ETa',unit:'mm/day',panel:'water',color:'#6D001F',mark:'line'},
  {key:'ETo_mm',label:'Reference ETo',unit:'mm/day',panel:'water',color:'#B07B3D',mark:'line'},
  {key:'Drainage_mm',label:'Modeled drainage',unit:'mm/day',panel:'water',color:'#427B9C',mark:'line'},
  {key:'Nitrate_load_estimated_kg_ha_day',label:'Estimated analyte load',unit:'kg/ha/day',panel:'load',color:'#80604A',mark:'bar'},
  {key:'Nitrate_mg_L',label:'Measured nitrate',unit:'mg/L',panel:'nitrate',color:'#A05544',mark:'point'},
  {key:'Nitrate_concentration_estimated_mg_L',label:'Estimated interval concentration',unit:'mg/L',panel:'nitrate',color:'#B07B3D',mark:'line',estimated:true},
  {key:'6in_VWC %',label:'6 in VWC',unit:'%',panel:'moisture',color:'#6D001F',mark:'point'},
  {key:'12in_VWC %',label:'12 in VWC',unit:'%',panel:'moisture',color:'#A0584E',mark:'point'},
  {key:'18in_VWC %',label:'18 in VWC',unit:'%',panel:'moisture',color:'#B07B3D',mark:'point'},
  {key:'24_inVWC %',label:'24 in VWC',unit:'%',panel:'moisture',color:'#5B8B75',mark:'point'},
  {key:'36in_VWC %',label:'36 in VWC',unit:'%',panel:'moisture',color:'#427B9C',mark:'point'}
 ];
 const panelLabels={water:'Water flux · mm/day',load:'Estimated analyte load · kg/ha/day',nitrate:'Nitrate concentration · mg/L',moisture:'Raw PR2 volumetric water content · %'};
 const defaults=['Rain_mm','ETa_model_mm','ETo_mm','Drainage_mm','Nitrate_load_estimated_kg_ha_day','Nitrate_mg_L','6in_VWC %','36in_VWC %'];
 const selected=new Set(defaults);
 const card=document.createElement('section');
 card.id='scientificExplorerCard';card.className='card scientific-explorer-card';
 document.getElementById('results-explorer').append(card);
 let currentRows=[],currentMetadata=null,currentSummary=null,currentObservations=null;
 const escape=value=>String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const number=(value,digits=1)=>Number(value).toLocaleString(undefined,{maximumFractionDigits:digits,minimumFractionDigits:digits});
 const numeric=value=>typeof value==='number'&&Number.isFinite(value);
 const measured=(item,value)=>numeric(value)&&(item.panel!=='moisture'||(value>=0&&value<=100))&&(!['nitrate','load'].includes(item.panel)||value>=0);
 const dateLabel=date=>new Date(`${String(date).slice(0,10)}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'});
 const fullDate=date=>String(date).slice(0,10);
 const records=rows=>(rows||[]).filter(row=>typeof row.Date==='string'&&/^\d{4}-\d{2}-\d{2}/.test(row.Date)).slice().sort((a,b)=>a.Date.localeCompare(b.Date));
 const timestamp=date=>Date.parse(`${String(date).slice(0,10)}T00:00:00Z`);
 function completeTimeline(daily,observations){
  const merged=new Map();
  for(const row of records(daily))merged.set(String(row.Date).slice(0,10),{...row,Date:String(row.Date).slice(0,10)});
  if(Array.isArray(observations))for(const row of records(observations)){
   const date=String(row.Date).slice(0,10),item=merged.get(date)||{Date:date};
   for(const key of ['Nitrate_mg_L','Nitrate_original_value','Nitrate_source','Nitrate_status','Nitrate_sample_count','Observed_storage_mm','In_model_period',...series.filter(seriesItem=>seriesItem.panel==='moisture').map(seriesItem=>seriesItem.key)])if(Object.prototype.hasOwnProperty.call(row,key))item[key]=row[key];
   merged.set(date,item);
  }
  return records([...merged.values()]);
 }
 function niceCeiling(value){
  if(value<=0)return 1;
  const base=Math.pow(10,Math.floor(Math.log10(value))),scaled=value/base;
  return (scaled<=1?1:scaled<=2?2:scaled<=2.5?2.5:scaled<=5?5:10)*base;
 }
 function axisDecimals(step){
  for(let digits=0;digits<=6;digits++){
   const labels=[0,1,2,3,4].map(index=>(index*step).toFixed(digits));
   if(new Set(labels).size===5)return digits;
  }
  return 6;
 }
 function option(item){
  return `<label class="scientific-option"><input type="checkbox" data-scientific-series="${escape(item.key)}" ${selected.has(item.key)?'checked':''}><i style="background:${item.color}"></i><span>${escape(item.label)}</span></label>`;
 }
 function controls(){
  return `<div class="scientific-controls" aria-label="Choose timeline variables">${[['water','Water balance'],['load','Estimated load'],['nitrate','Nitrate sampling'],['moisture','Soil moisture depths']].map(([panel,label])=>`<fieldset class="scientific-control-group"><legend>${label}</legend><div class="scientific-options">${series.filter(item=>item.panel===panel).map(option).join('')}</div></fieldset>`).join('')}</div>`;
 }
 function chart(rows,panel,items,showDates){
  const w=960,h=showDates?238:205,left=67,right=20,top=24,bottom=185,plotW=w-left-right,plotH=bottom-top;
  /* Scan by selected item so invalid PR2 values never set the chart scale. */
  const validValues=[];
  for(const row of rows)for(const item of items)if(measured(item,row[item.key]))validValues.push(row[item.key]);
  if(!validValues.length)return '<div class="scientific-empty">No valid values for these variables in the selected plot and period. Missing and invalid readings stay absent.</div>';
  const max=niceCeiling(Math.max(...validValues)*1.04),y=value=>bottom-value/max*plotH;
  const digits=axisDecimals(max/4);
  const times=rows.map(row=>timestamp(row.Date)),minTime=Math.min(...times),lastTime=Math.max(...times),endTime=lastTime===minTime?lastTime+86400000:lastTime;
  const xTime=time=>left+(time-minTime)/(endTime-minTime)*plotW;
  const x=index=>xTime(times[index]);
  const dayStep=plotW/Math.max(1,(endTime-minTime)/86400000);
  let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(panelLabels[panel])} by date"><title>${escape(panelLabels[panel])} for the selected plot across full sampled and modeled dates</title><desc>Panels use a shared true date scale and separate units. Shading marks the modeled analysis period. Nitrate and soil moisture are shown on observed dates.</desc>`;
  const modelDates=records(currentRows).map(row=>timestamp(row.Date));
  if(modelDates.length){
   const from=Math.max(left,xTime(Math.min(...modelDates))),to=Math.min(w-right,xTime(Math.max(...modelDates)));
   if(to>=from)svg+=`<rect x="${from}" y="${top}" width="${Math.max(1,to-from)}" height="${plotH}" fill="#f8f1eb"/><line x1="${from}" y1="${top}" x2="${from}" y2="${bottom}" stroke="#c4a79a" stroke-dasharray="4 4"/><line x1="${to}" y1="${top}" x2="${to}" y2="${bottom}" stroke="#c4a79a" stroke-dasharray="4 4"/>`;
  }
  for(let tick=0;tick<=4;tick++){
   const value=max*tick/4,at=y(value);
   svg+=`<line x1="${left}" x2="${w-right}" y1="${at}" y2="${at}" stroke="${tick?'#e8e2dc':'#a99d94'}"/><text x="${left-12}" y="${at+4}" text-anchor="end">${number(value,digits)}</text>`;
  }
  const bars=items.filter(item=>item.mark==='bar'),barW=Math.max(1,Math.min(5,dayStep*.32));
  bars.forEach((item,barIndex)=>rows.forEach((row,index)=>{
   const value=row[item.key];if(!measured(item,value))return;
   const bx=x(index)-(bars.length*barW)/2+barIndex*barW,at=y(value);
   svg+=`<rect x="${bx}" y="${at}" width="${barW}" height="${Math.max(.6,bottom-at)}" fill="${item.color}" opacity=".82"><title>${escape(dateLabel(row.Date))}: ${escape(item.label)} ${number(value,2)} ${escape(item.unit)}</title></rect>`;
  }));
  items.filter(item=>item.mark==='line').forEach(item=>{
   let path='',connected=false,lastValidTime=null;
   rows.forEach((row,index)=>{const value=row[item.key];if(measured(item,value)){if(lastValidTime!==null&&times[index]-lastValidTime>129600000)connected=false;path+=`${connected?'L':'M'}${x(index).toFixed(2)},${y(value).toFixed(2)} `;connected=true;lastValidTime=times[index];}else{connected=false;lastValidTime=null;}});
   svg+=`<path d="${path}" fill="none" stroke="${item.color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" ${item.estimated?'stroke-dasharray="5 5"':''}/>`;
   rows.forEach((row,index)=>{const value=row[item.key];if(measured(item,value))svg+=`<circle cx="${x(index)}" cy="${y(value)}" r="6" fill="transparent"><title>${escape(dateLabel(row.Date))}: ${escape(item.label)} ${number(value,2)} ${escape(item.unit)}</title></circle>`;});
  });
  items.filter(item=>item.mark==='point').forEach(item=>rows.forEach((row,index)=>{
   const value=row[item.key];if(!measured(item,value))return;
   const modelStart=modelDates.length?Math.min(...modelDates):null,modelEnd=modelDates.length?Math.max(...modelDates):null;
   const outside=modelStart!==null&&(times[index]<modelStart||times[index]>modelEnd);
   svg+=`<circle cx="${x(index)}" cy="${y(value)}" r="4.1" fill="${outside?'white':item.color}" stroke="${item.color}" stroke-width="${outside?2:1.2}"><title>${escape(dateLabel(row.Date))}: observed ${escape(item.label)} ${number(value,2)} ${escape(item.unit)}${outside?' · outside modeled period':''}</title></circle>`;
  }));
  if(panel==='nitrate'&&items.some(item=>item.key==='Nitrate_mg_L'))rows.forEach((row,index)=>{
   if(!row.Nitrate_status||numeric(row.Nitrate_mg_L))return;
   const cx=x(index),cy=bottom-6;
   svg+=`<path d="M${cx-3},${cy-3}L${cx+3},${cy+3}M${cx+3},${cy-3}L${cx-3},${cy+3}" stroke="#9b8379" stroke-width="1.5"><title>${escape(dateLabel(row.Date))}: no valid nitrate concentration · ${escape(row.Nitrate_status)} · original ${escape(row.Nitrate_original_value)}</title></path>`;
  });
  if(showDates){
   const ticks=6;
   for(let index=0;index<=ticks;index++){
    const time=minTime+(endTime-minTime)*index/ticks;
    const crossYear=new Date(minTime).getUTCFullYear()!==new Date(endTime).getUTCFullYear();
    svg+=`<text x="${xTime(time)}" y="${bottom+25}" text-anchor="${index===0?'start':index===ticks?'end':'middle'}">${escape(new Date(time).toLocaleDateString(undefined,crossYear?{month:'short',year:'2-digit',timeZone:'UTC'}:{month:'short',day:'numeric',timeZone:'UTC'}))}</text>`;
   }
  }
  svg+='</svg>';
  return `<div class="scientific-svg">${svg}</div>`;
 }
 function panel(rows,id,items,showDates){
  const counts=items.map(item=>({item,count:rows.filter(row=>measured(item,row[item.key])).length}));
  const invalid=items.filter(item=>item.panel==='moisture').reduce((sum,item)=>sum+rows.filter(row=>numeric(row[item.key])&&(row[item.key]<0||row[item.key]>100)).length,0);
  const legend=counts.map(({item,count})=>`<span class="scientific-legend-item"><i style="background:${item.color}"></i>${escape(item.label)} <small>n=${count}</small></span>`).join('');
  const detail=id==='water'?'Daily modeled fluxes and recorded inputs':id==='load'?'Estimated only within paired valid sample intervals':id==='nitrate'?'Measured points and optional estimated interval line':'Original PR2 sensor depths; measured dates only';
  return `<section class="scientific-panel" aria-label="${escape(panelLabels[id])}"><div class="scientific-panel-heading"><div><h3>${escape(panelLabels[id])}</h3><span>${detail}</span></div><div class="scientific-legend">${legend}</div></div>${chart(rows,id,items,showDates)}${invalid?`<p class="scientific-note">${invalid} out-of-range VWC reading${invalid===1?'':'s'} excluded from this chart; original input remains in the audit.</p>`:''}</section>`;
 }
 function insights(rows){
  const messages=[];
  const modelRows=records(currentRows);
  const drainage=series.find(item=>item.key==='Drainage_mm');
  if(selected.has('Drainage_mm')){
   const days=modelRows.filter(row=>measured(drainage,row.Drainage_mm)&&row.Drainage_mm>0);
   messages.push(`Modeled drainage is above zero on ${days.length} of ${modelRows.length} model days.`);
  }
  if(selected.has('ETa_model_mm')&&selected.has('ETo_mm')){
   const pairs=modelRows.filter(row=>numeric(row.ETa_model_mm)&&numeric(row.ETo_mm));
   const eta=pairs.reduce((sum,row)=>sum+row.ETa_model_mm,0),eto=pairs.reduce((sum,row)=>sum+row.ETo_mm,0);
   if(pairs.length&&eto>0)messages.push(`Modeled ETa is ${number(eta/eto*100,0)}% of reference ETo over ${pairs.length} paired days.`);
  }
  if(selected.has('Nitrate_mg_L')){
   const item=series.find(seriesItem=>seriesItem.key==='Nitrate_mg_L');
   const count=rows.filter(row=>measured(item,row.Nitrate_mg_L)).length;
   const excluded=rows.filter(row=>row.Nitrate_status&&!measured(item,row.Nitrate_mg_L)).length;
   messages.push(`${count} valid nitrate concentration date${count===1?'':'s'} appear as points${excluded?`; ${excluded} excluded collection date${excluded===1?'':'s'} are marked at the baseline`:''}.`);
  }
  if(selected.has('Nitrate_load_estimated_kg_ha_day')){
   const item=series.find(seriesItem=>seriesItem.key==='Nitrate_load_estimated_kg_ha_day');
   const covered=modelRows.filter(row=>measured(item,row[item.key]));
   if(covered.length)messages.push(`Estimated analyte load sums to ${number(covered.reduce((sum,row)=>sum+row[item.key],0),2)} kg/ha across ${covered.length} interval days; values outside paired sample intervals are absent.`);
  }
  return messages.join(' ');
 }
 function render(){
  const rows=completeTimeline(currentRows,currentObservations),name=currentMetadata?`${escape(currentMetadata.Site)} ${escape(currentMetadata.Year)} · plot ${escape(currentMetadata.Plot)}${currentMetadata.Dataset?` · ${escape(currentMetadata.Dataset)}`:''}`:'Selected plot';
  const observed=records(Array.isArray(currentObservations)?currentObservations:currentRows);
  const nitrateSamples=observed.filter(row=>row.Nitrate_status||row.Nitrate_source||numeric(row.Nitrate_mg_L));
  const validNitrate=nitrateSamples.filter(row=>numeric(row.Nitrate_mg_L)&&row.Nitrate_mg_L>=0).length;
  const sampleSpan=nitrateSamples.length?`${escape(fullDate(nitrateSamples[0].Date))}–${escape(fullDate(nitrateSamples[nitrateSamples.length-1].Date))}`:'none';
  const active=series.filter(item=>selected.has(item.key));
  const activePanels=['water','load','nitrate','moisture'].filter(id=>active.some(item=>item.panel===id));
  const datePanel=activePanels.map((id,index)=>({id,index})).filter(({id})=>rows.some(row=>active.some(item=>item.panel===id&&measured(item,row[item.key])))).pop();
  card.innerHTML=`<div class="scientific-header"><div><div class="eyebrow">LINKED FIELD TIMELINE</div><h2>Follow the water, soil and nitrate together</h2><p>${name} · timeline ${rows.length?`${escape(fullDate(rows[0].Date))}–${escape(fullDate(rows[rows.length-1].Date))}`:'no dates'} · ${nitrateSamples.length} nitrate collection dates (${sampleSpan}), ${validNitrate} valid · shared date axis</p></div></div>${controls()}<div class="scientific-panels">${active.length&&rows.length?activePanels.map((id,index)=>panel(rows,id,active.filter(item=>item.panel===id),datePanel&&index===datePanel.index)).join(''):'<div class="scientific-empty">Select at least one variable with available dates to build the timeline.</div>'}</div>${active.length&&rows.length?`<div class="scientific-insight"><strong>From this plot</strong><p>${escape(insights(rows))}</p></div>`:''}<p class="scientific-note">Panels share true dates but use separate scales and units. Pale shading marks the modeled period; hollow observation points are outside it. A × at the nitrate baseline marks a collection date without a valid concentration. Drainage is modeled water flux; the load panel is estimated from paired nitrate intervals with analyte basis from your run settings. Measured nitrate and PR2 VWC are points on observed dates. Missing dates are never filled or interpolated in measured series. These patterns are descriptive and do not establish cause.</p>`;
 }
 card.addEventListener('change',event=>{
  const input=event.target;if(!input.matches('[data-scientific-series]'))return;
  if(input.checked)selected.add(input.dataset.scientificSeries);else selected.delete(input.dataset.scientificSeries);
  render();
 });
 window.drawScientificExplorer=(rows,metadata,summary,observations)=>{currentRows=rows;currentMetadata=metadata;currentSummary=summary;currentObservations=observations;render();};
 window.resetScientificExplorerData=()=>{currentRows=[];currentMetadata=null;currentSummary=null;currentObservations=null;};
})();
