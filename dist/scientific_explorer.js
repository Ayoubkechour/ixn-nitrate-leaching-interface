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
 let currentPlotKey='',rangeMode='full',rangeFrom='',rangeTo='',displayBounds=['',''];
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
   Object.assign(item,row,{Date:date});
   merged.set(date,item);
  }
  return records([...merged.values()]);
 }
 function bounds(rows){return rows.length?[fullDate(rows[0].Date),fullDate(rows[rows.length-1].Date)]:['',''];}
 function activeBounds(all){
  const full=bounds(all),model=bounds(records(currentRows));
  if(rangeMode==='model'&&model[0])return model;
  if(rangeMode==='custom')return [rangeFrom||full[0],rangeTo||full[1]];
  return full;
 }
 const inRange=(row,from,to)=>fullDate(row.Date)>=from&&fullDate(row.Date)<=to;
 function rangeControls(full,model,active,visibleCount){
  return `<div class="scientific-range"><div class="scientific-presets" role="group" aria-label="Date window"><button type="button" data-scientific-preset="full" class="${rangeMode==='full'?'active':''}" aria-pressed="${rangeMode==='full'}">Full sampling window</button><button type="button" data-scientific-preset="model" class="${rangeMode==='model'?'active':''}" aria-pressed="${rangeMode==='model'}" ${model[0]?'':'disabled'}>Modeled period</button></div><label>From<input type="date" data-scientific-date="from" min="${full[0]}" max="${full[1]}" value="${active[0]}"></label><label>To<input type="date" data-scientific-date="to" min="${full[0]}" max="${full[1]}" value="${active[1]}"></label><div class="scientific-export"><button type="button" data-scientific-export="csv" ${visibleCount?'':'disabled'}>Download data CSV</button><button type="button" data-scientific-export="svg" ${visibleCount?'':'disabled'}>Download figure SVG</button></div></div><p class="scientific-range-status">Showing ${visibleCount} dated record${visibleCount===1?'':'s'} from ${escape(active[0])} to ${escape(active[1])}. Empty measurements remain blank.</p>`;
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
  const excludedOnly=panel==='nitrate'&&items.some(item=>item.key==='Nitrate_mg_L')&&rows.some(row=>row.Nitrate_status&&!numeric(row.Nitrate_mg_L));
  if(!validValues.length&&!excludedOnly)return '<div class="scientific-empty">No valid values for these variables in the selected date window. Missing and invalid readings stay absent.</div>';
  const max=validValues.length?niceCeiling(Math.max(...validValues)*1.04):1,y=value=>bottom-value/max*plotH;
  const digits=axisDecimals(max/4);
  const times=rows.map(row=>timestamp(row.Date)),minTime=timestamp(displayBounds[0]),lastTime=timestamp(displayBounds[1]),endTime=lastTime===minTime?lastTime+86400000:lastTime;
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
   rows.forEach((row,index)=>{const value=row[item.key];if(measured(item,value)){const isolated=!rows.some((other,j)=>j!==index&&Math.abs(times[j]-times[index])<=129600000&&measured(item,other[item.key]));svg+=`<circle cx="${x(index)}" cy="${y(value)}" r="${isolated?4:6}" fill="${isolated?item.color:'transparent'}"><title>${escape(dateLabel(row.Date))}: ${escape(item.label)} ${number(value,2)} ${escape(item.unit)}</title></circle>`;}});
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
   const ticks=lastTime===minTime?0:6;
   for(let index=0;index<=ticks;index++){
    const time=ticks?minTime+(endTime-minTime)*index/ticks:minTime;
    const crossYear=new Date(minTime).getUTCFullYear()!==new Date(endTime).getUTCFullYear();
    svg+=`<text x="${xTime(time)}" y="${bottom+25}" text-anchor="${index===0?'start':index===ticks?'end':'middle'}">${escape(new Date(time).toLocaleDateString(undefined,crossYear?{month:'short',year:'2-digit',timeZone:'UTC'}:{month:'short',day:'numeric',timeZone:'UTC'}))}</text>`;
   }
  }
  svg+='</svg>';
  return `<div class="scientific-svg">${svg}</div>${!validValues.length?'<p class="scientific-note">No valid nitrate concentrations in this range; × marks excluded collection dates on the date axis.</p>':''}`;
 }
 function panel(rows,id,items,showDates){
  const counts=items.map(item=>({item,count:rows.filter(row=>measured(item,row[item.key])).length}));
  const invalid=items.filter(item=>item.panel==='moisture').reduce((sum,item)=>sum+rows.filter(row=>numeric(row[item.key])&&(row[item.key]<0||row[item.key]>100)).length,0);
  const legend=counts.map(({item,count})=>`<span class="scientific-legend-item"><i style="background:${item.color}"></i>${escape(item.label)} <small>n=${count}</small></span>`).join('');
  const detail=id==='water'?'Daily modeled fluxes and recorded inputs':id==='load'?'Estimated only within paired valid sample intervals':id==='nitrate'?'Measured points and optional estimated interval line':'Original PR2 sensor depths; measured dates only';
  return `<section class="scientific-panel" aria-label="${escape(panelLabels[id])}"><div class="scientific-panel-heading"><div><h3>${escape(panelLabels[id])}</h3><span>${detail}</span></div><div class="scientific-legend">${legend}</div></div>${chart(rows,id,items,showDates)}${invalid?`<p class="scientific-note">${invalid} out-of-range VWC reading${invalid===1?'':'s'} excluded from this chart; original input remains in the audit.</p>`:''}</section>`;
 }
 function insights(rows,from,to){
  const messages=[];
  const modelRows=records(currentRows).filter(row=>inRange(row,from,to));
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
  const all=completeTimeline(currentRows,currentObservations),full=bounds(all),model=bounds(records(currentRows)),active=activeBounds(all);
  displayBounds=active;
  const rows=all.filter(row=>inRange(row,active[0],active[1]));
  const name=currentMetadata?`${escape(currentMetadata.Site)} ${escape(currentMetadata.Year)} · plot ${escape(currentMetadata.Plot)}${currentMetadata.Dataset?` · ${escape(currentMetadata.Dataset)}`:''}`:'Selected plot';
  const observed=records(Array.isArray(currentObservations)?currentObservations:currentRows).filter(row=>inRange(row,active[0],active[1]));
  const nitrateSamples=observed.filter(row=>row.Nitrate_status||row.Nitrate_source||numeric(row.Nitrate_mg_L));
  const validNitrate=nitrateSamples.filter(row=>numeric(row.Nitrate_mg_L)&&row.Nitrate_mg_L>=0).length;
  const sampleSpan=nitrateSamples.length?`${escape(fullDate(nitrateSamples[0].Date))}–${escape(fullDate(nitrateSamples[nitrateSamples.length-1].Date))}`:'none';
  const activeSeries=series.filter(item=>selected.has(item.key));
  const activePanels=['water','load','nitrate','moisture'].filter(id=>activeSeries.some(item=>item.panel===id));
  const datePanel=activePanels.map((id,index)=>({id,index})).filter(({id})=>rows.some(row=>activeSeries.some(item=>item.panel===id&&measured(item,row[item.key]))||(id==='nitrate'&&row.Nitrate_status))).pop();
  card.innerHTML=`<div class="scientific-header"><div><div class="eyebrow">LINKED FIELD TIMELINE</div><h2>Follow the water, soil and nitrate together</h2><p>${name} · selected ${active[0]}–${active[1]} · ${nitrateSamples.length} nitrate collection dates (${sampleSpan}), ${validNitrate} valid</p></div></div>${rangeControls(full,model,active,rows.length)}${controls()}<div class="scientific-panels">${activeSeries.length&&rows.length?activePanels.map((id,index)=>panel(rows,id,activeSeries.filter(item=>item.panel===id),datePanel&&index===datePanel.index)).join(''):'<div class="scientific-empty">No dated records in this range, or no variables selected. Choose another range or variable.</div>'}</div>${activeSeries.length&&rows.length?`<div class="scientific-insight"><strong>From this plot and date range</strong><p>${escape(insights(rows,active[0],active[1]))}</p></div>`:''}<p class="scientific-note">Panels share true dates but use separate scales and units. Pale shading marks the modeled period; hollow observation points are outside it. A × at the nitrate baseline marks a collection date without a valid concentration. Drainage is modeled water flux; the load panel is estimated from paired nitrate intervals with analyte basis from your run settings. Measured nitrate and PR2 VWC are points on observed dates. Missing dates are never filled or interpolated in measured series. These patterns are descriptive and do not establish cause.</p>`;
 }
 function saveFile(name,contents,type){
  const url=URL.createObjectURL(new Blob([contents],{type})),link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const exportName=extension=>`ixn_${String(currentMetadata?.Site||'site').replace(/[^a-z0-9]+/gi,'_')}_${currentMetadata?.Year||'year'}_plot_${currentMetadata?.Plot||'plot'}_${displayBounds[0]}_${displayBounds[1]}.${extension}`;
 function exportCsv(){
  const rows=completeTimeline(currentRows,currentObservations).filter(row=>inRange(row,displayBounds[0],displayBounds[1]));
  const fields=['Date','Calendar_year','In_model_period',...series.filter(item=>selected.has(item.key)).map(item=>item.key),'Nitrate_original_value','Nitrate_status','Nitrate_source','Nitrate_date_source','Nitrate_sample_count','Moisture_source','Invalid_VWC_count','Complete_profile','Nitrate_concentration_method','Nitrate_load_basis'];
  const unique=[...new Set(fields)],quote=value=>`"${String(value==null?'':value).replace(/"/g,'""')}"`;
  const heading=['Dataset','Site','Study_year','Plot',...unique.map(key=>{const item=series.find(value=>value.key===key);return item?`${key} [${item.unit}]`:key;})];
  const lines=[heading.map(quote).join(','),...rows.map(row=>[currentMetadata?.Dataset,currentMetadata?.Site,currentMetadata?.Year,currentMetadata?.Plot,...unique.map(key=>key==='In_model_period'&&row[key]==null?records(currentRows).some(day=>fullDate(day.Date)===fullDate(row.Date)):row[key])].map(quote).join(','))];
  saveFile(exportName('csv'),'\uFEFF'+lines.join('\r\n'),'text/csv;charset=utf-8');
 }
 function exportSvg(){
  const panels=[...card.querySelectorAll('.scientific-panel')].map(element=>({
   title:element.querySelector('h3')?.textContent||'',
   svg:element.querySelector('.scientific-svg svg'),
   group:[...element.querySelectorAll('.scientific-legend-item')].map(item=>({label:item.textContent.trim(),color:item.querySelector('i')?.style.background||'#6d001f'}))
  })).filter(item=>item.svg);
  if(!panels.length)return;
  const plotted=completeTimeline(currentRows,currentObservations).filter(row=>inRange(row,displayBounds[0],displayBounds[1]));
  const identity=`${currentMetadata?.Dataset||'Dataset'} · ${currentMetadata?.Site||'Site'} ${currentMetadata?.Year||''} · plot ${currentMetadata?.Plot||''}`;
  let y=105,body='';
  for(const item of panels){
   const viewBox=item.svg.getAttribute('viewBox')||'0 0 960 238',height=Number(viewBox.split(/\s+/)[3])||238;
   const keys=item.group.map((key,index)=>`<rect x="${30+index*190}" y="${y+12}" width="9" height="9" fill="${escape(key.color)}"/><text x="${43+index*190}" y="${y+21}" font-size="11" fill="#655a55">${escape(key.label)}</text>`).join('');
   body+=`<text x="30" y="${y}" font-size="19" font-weight="700" fill="#342b29">${escape(item.title)}</text>${keys}<svg x="20" y="${y+28}" width="960" height="${height}" viewBox="${viewBox}" font-size="12" fill="#756b66">${item.svg.innerHTML}</svg>`;
   y+=height+75;
  }
  const totalHeight=y+65;
  const figure=`<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${totalHeight}" viewBox="0 0 1000 ${totalHeight}" font-family="Arial, sans-serif"><title>IXN field timeline · ${escape(identity)}</title><desc>Selected date range ${escape(displayBounds[0])} through ${escape(displayBounds[1])}. Separate axes and units. Pale shading marks the modeled period; sampled nitrate and VWC are observation points.</desc><rect width="1000" height="${totalHeight}" fill="#fffdfb"/><text x="30" y="40" font-size="24" font-weight="700" fill="#6D001F">IXN field timeline</text><text x="30" y="66" font-size="14" fill="#342b29">${escape(identity)} · ${escape(displayBounds[0])} to ${escape(displayBounds[1])} · ${plotted.length} dated records</text>${body}<text x="30" y="${totalHeight-33}" font-size="11" fill="#655a55">Modeled fluxes and estimated load are distinct from measured nitrate and soil moisture. Missing values are not zero.</text></svg>`;
  saveFile(exportName('svg'),figure,'image/svg+xml;charset=utf-8');
 }
 card.addEventListener('change',event=>{
  const input=event.target;
  if(input.matches('[data-scientific-series]')){if(input.checked)selected.add(input.dataset.scientificSeries);else selected.delete(input.dataset.scientificSeries);render();return;}
  if(input.matches('[data-scientific-date]')){
   const all=bounds(completeTimeline(currentRows,currentObservations)),from=input.dataset.scientificDate==='from'?input.value:card.querySelector('[data-scientific-date="from"]').value,to=input.dataset.scientificDate==='to'?input.value:card.querySelector('[data-scientific-date="to"]').value;
   rangeFrom=from<all[0]?all[0]:from>all[1]?all[1]:from;rangeTo=to<all[0]?all[0]:to>all[1]?all[1]:to;
   if(rangeFrom>rangeTo){if(input.dataset.scientificDate==='from')rangeTo=rangeFrom;else rangeFrom=rangeTo;}
   rangeMode='custom';render();
  }
 });
 card.addEventListener('click',event=>{
  const preset=event.target.closest('[data-scientific-preset]');if(preset){rangeMode=preset.dataset.scientificPreset;rangeFrom='';rangeTo='';render();return;}
  const exportButton=event.target.closest('[data-scientific-export]');if(exportButton){if(exportButton.dataset.scientificExport==='csv')exportCsv();else exportSvg();}
 });
 window.drawScientificExplorer=(rows,metadata,summary,observations)=>{
  const key=JSON.stringify([metadata?.Dataset,metadata?.Site,metadata?.Year,metadata?.Plot]);
  if(key!==currentPlotKey){currentPlotKey=key;rangeMode='full';rangeFrom='';rangeTo='';}
  currentRows=rows;currentMetadata=metadata;currentSummary=summary;currentObservations=observations;render();
 };
 window.resetScientificExplorerData=()=>{currentRows=[];currentMetadata=null;currentSummary=null;currentObservations=null;currentPlotKey='';rangeMode='full';rangeFrom='';rangeTo='';};
})();
