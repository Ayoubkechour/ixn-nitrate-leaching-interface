/* Site-wide ET summaries use the plot-level monthly values in the run payload. */
'use strict';
(() => {
 const card=document.createElement('section');
 card.id='siteETCard';
 card.className='card site-et-card';
 const anchor=document.getElementById('siteETMatrix')||document.querySelector('#results-plots > .card');
 anchor.before(card);
 let mode='monthly',lastRows=[],lastPayload=null;
 const safe=value=>String(value==null?'':value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const valid=value=>typeof value==='number'&&Number.isFinite(value);
 const fmt=(value,digits=1)=>valid(value)?value.toLocaleString(undefined,{maximumFractionDigits:digits,minimumFractionDigits:digits}):'—';
 const key=row=>JSON.stringify([row.Dataset,row.Site,row.Year,row.Plot]);
 const siteKey=row=>JSON.stringify([row.Dataset,row.Site,row.Year]);
 const monthName=month=>new Date(`${month}-01T12:00:00`).toLocaleDateString(undefined,{month:'short'});
 function summarize(rows,payload){
  const siteYears=[...new Set(rows.map(siteKey))];
  if(!rows.length)return {message:'No plots match the current filters.'};
  if(siteYears.length!==1)return {message:'Select one site and year to see a site-wide ET time series. Monthly values from different years are kept separate.'};
  const identities=new Set(rows.map(key));
  const records=((payload&&payload.monthly_et)||[]).filter(row=>identities.has(key(row))&&valid(row.ETa_model_mm)&&valid(row.ETo_mm)&&(!('ETa_days' in row)||row.ETa_days>0)&&(!('ETo_days' in row)||row.ETo_days>0));
  if(!records.length)return {message:'Monthly ET values are unavailable for the selected plots. Run the analysis again with this version of the interface.'};
  const groups=new Map();
  for(const row of records){
   const month=String(row.Month);
   if(!groups.has(month))groups.set(month,{month,eta:[],eto:[],plots:new Set(),coverage:[]});
   const group=groups.get(month);
   group.eta.push(row.ETa_model_mm);group.eto.push(row.ETo_mm);group.plots.add(key(row));
   if(valid(row.Days)&&valid(row.ETa_days)&&valid(row.ETo_days))group.coverage.push([row.Days,row.ETa_days,row.ETo_days]);
  }
  const months=[...groups.values()].sort((a,b)=>a.month.localeCompare(b.month)).map(group=>({
   month:group.month,n:group.plots.size,
   partial:group.coverage.some(([days,etaDays,etoDays])=>days<new Date(Number(group.month.slice(0,4)),Number(group.month.slice(5,7)),0).getDate()||etaDays<days||etoDays<days),
   eta:group.eta.reduce((sum,value)=>sum+value,0)/group.eta.length,
   eto:group.eto.reduce((sum,value)=>sum+value,0)/group.eto.length
  }));
  let etaTotal=0,etoTotal=0;
  for(const item of months){etaTotal+=item.eta;etoTotal+=item.eto;item.etaCumulative=etaTotal;item.etoCumulative=etoTotal;}
  return {months,siteYear:rows[0],plotYears:identities.size,etaTotal,etoTotal};
 }
 function chart(data){
  const {months}=data,w=900,h=326,left=62,right=18,top=32,bottom=270,chartW=w-left-right,chartH=bottom-top;
  const monthly=mode==='monthly';
  const etaKey=monthly?'eta':'etaCumulative',etoKey=monthly?'eto':'etoCumulative';
  const max=Math.max(1,...months.flatMap(item=>[item[etaKey],item[etoKey]]))*1.12;
  const y=value=>bottom-value/max*chartH;
  const x=index=>left+(index+.5)*chartW/months.length;
  let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${monthly?'Monthly':'Cumulative'} modeled ET and reference ET by month, millimeters"><title>${monthly?'Monthly':'Cumulative'} site-wide ET, mean across selected plots</title><desc>Modeled ETa and ETo are summarized from plot-month values. The plot count is shown for each month.</desc><text x="${left}" y="15" class="axis-unit">mm${monthly?' / month':''}</text>`;
  for(let tick=0;tick<=4;tick++){
   const value=max*tick/4,at=y(value);
   svg+=`<line x1="${left}" x2="${w-right}" y1="${at}" y2="${at}" stroke="${tick?'#e8e2db':'#afa49a'}" stroke-width="${tick?1:1.3}"/><text x="${left-12}" y="${at+4}" text-anchor="end">${fmt(value,0)}</text>`;
  }
  if(monthly){
   const groupWidth=chartW/months.length,barWidth=Math.min(34,groupWidth*.29);
   months.forEach((item,index)=>{
    const center=x(index);
    for(const [key,color,offset,label] of [[etaKey,'#6D001F',-barWidth-2,'Modeled ETa'],[etoKey,'#B07B3D',2,'Reference ETo']]){
     const value=item[key],at=y(value);
     svg+=`<rect x="${center+offset}" y="${at}" width="${barWidth}" height="${Math.max(0,bottom-at)}" rx="3" fill="${color}"><title>${safe(monthName(item.month))} ${safe(item.month.slice(0,4))}: ${label} ${fmt(value)} mm; n=${item.n} plots</title></rect>`;
    }
   });
  }else{
   for(const [key,color,label] of [[etaKey,'#6D001F','Modeled ETa'],[etoKey,'#B07B3D','Reference ETo']]){
    const points=months.map((item,index)=>`${x(index)},${y(item[key])}`).join(' ');
    svg+=`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    months.forEach((item,index)=>{svg+=`<circle cx="${x(index)}" cy="${y(item[key])}" r="5" fill="white" stroke="${color}" stroke-width="2"><title>Through ${safe(monthName(item.month))} ${safe(item.month.slice(0,4))}: ${label} ${fmt(item[key])} mm; month n=${item.n} plots</title></circle>`;});
   }
  }
   months.forEach((item,index)=>{svg+=`<text x="${x(index)}" y="${bottom+23}" text-anchor="middle">${safe(monthName(item.month))}${item.partial?'*':''}</text><text x="${x(index)}" y="${bottom+39}" text-anchor="middle" class="et-plot-count">n=${item.n}</text>`;});
  svg+='</svg>';
  return `<div class="chart-key" aria-label="ET series legend"><span><i style="background:#6D001F"></i>Modeled ETa</span><span><i style="background:#B07B3D"></i>Reference ETo</span><span>Monthly mean across selected plots · n per month below axis</span></div><div class="chart">${svg}</div>`;
 }
 function render(){
  const data=summarize(lastRows,lastPayload);
  if(data.message){card.innerHTML=`<div class="card-title"><div><h2>Site-wide evapotranspiration</h2><p>Monthly and cumulative ET across the selected plots</p></div></div><div class="chart-empty">${safe(data.message)}</div>`;return;}
  const {months,siteYear,plotYears,etaTotal,etoTotal}=data;
  const peak=months.reduce((best,item)=>item.eta>best.eta?item:best,months[0]);
  const gap=etoTotal>0?100*(1-etaTotal/etoTotal):null;
  const counts=months.map(item=>item.n),minCount=Math.min(...counts),maxCount=Math.max(...counts);
  const coverage=minCount===maxCount?`${minCount} plots in every month`:`${minCount}–${maxCount} plots per month`;
  const partial=months.filter(item=>item.partial).map(item=>monthName(item.month));
  card.innerHTML=`<div class="card-title"><div><div class="eyebrow">SITE / YEAR EVAPOTRANSPIRATION</div><h2>When water demand and modeled use diverge</h2><p>${safe(siteYear.Site)} ${safe(siteYear.Year)} · ${plotYears} selected plot-years · mean across plots</p></div><div class="et-switch" role="group" aria-label="ET chart view"><button type="button" data-et-mode="monthly" class="${mode==='monthly'?'active':''}" aria-pressed="${mode==='monthly'}">Monthly</button><button type="button" data-et-mode="cumulative" class="${mode==='cumulative'?'active':''}" aria-pressed="${mode==='cumulative'}">Cumulative</button></div></div><div class="et-stat-grid"><div class="et-stat"><span>Modeled ETa</span><strong>${fmt(etaTotal,0)} mm</strong><small>Sum of plot-month means</small></div><div class="et-stat"><span>Reference ETo</span><strong>${fmt(etoTotal,0)} mm</strong><small>Same months and selected plots</small></div><div class="et-stat"><span>Peak modeled ET</span><strong>${safe(monthName(peak.month))} · ${fmt(peak.eta,0)} mm</strong><small>Monthly mean</small></div></div>${chart(data)}<div class="et-insights"><div><strong>Reading the pattern</strong><p>Modeled ETa ${gap===null?'cannot be compared with ETo':`totals ${fmt(Math.abs(gap),0)}% ${gap>=0?'below':'above'} reference ETo`} over the displayed months. The highest mean modeled ET occurs in ${safe(monthName(peak.month))}. This is a descriptive comparison, not an OpenET observation or a treatment effect.</p></div></div><p class="et-note">Each month is the mean of plot-level monthly totals; ${coverage}. ${partial.length?`An asterisk marks a partial or incomplete month (${safe(partial.join(', '))}).`:'All plotted months have complete daily ET coverage.'} Missing plot-months are excluded and are never filled with zero.</p>`;
  card.querySelectorAll('[data-et-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.etMode;render();});
 }
 window.renderSiteET=(rows,payload)=>{lastRows=rows;lastPayload=payload;render();};
})();
