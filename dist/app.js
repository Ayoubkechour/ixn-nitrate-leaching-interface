'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {mode:'tables',files:{},rawFiles:[],worker:null,busy:false,local:false,results:null,downloads:{},job:null,poll:null,runGeneration:0,resultTab:'plots'};
const schema = {
 weather:{title:'Weather',required:true,description:'Daily temperatures, humidity, wind, solar radiation and rainfall.',columns:'Date, Tmax_C, Tmin_C, Wind_m_s, Rs_MJ_m2_day, Rain_mm, Tdew_C (or RHmin_pct + RHmax_pct)'},
 irrigation:{title:'Irrigation',required:true,description:'A complete event log, with plot IDs and amounts in millimeters.',columns:'Date, Plot, Irrigation_mm'},
 nitrate:{title:'Solution nitrate',description:'Measured concentrations and sampling dates for each plot.',columns:'Date, Plot, Nitrate_mg_L'},
 moisture:{title:'Soil moisture',description:'Upload raw PR2 VWC readings at five depths, or complete profile storage in mm.',columns:'Date, Plot, 6in_VWC %, 12in_VWC %, 18in_VWC %, 24_inVWC %, 36in_VWC % (or Observed_storage_mm)'},
 plots:{title:'Plot & treatment map',description:'Optional treatment labels and replicates for each field plot.',columns:'Plot, Irrigation_treatment, Nitrogen_treatment, Rep'},
 workbook:{title:'One workbook, all inputs',description:'Named sheets: Weather, Irrigation, Nitrate, Moisture, Plots.'},
 collection_calendar:{title:'Collection calendar',description:'Verified sampling dates: Site, Year, Week, Collection_date.',accept:'.csv'},
 run_config:{title:'Date & plot-map overrides',description:'JSON with planting/end date overrides and relative paths to plot maps.',accept:'.json'}
};
const groups = [
 {title:'Soil profile',subtitle:'Layer geometry and water-holding properties',open:true,fields:[
  ['soil_bottom_m','Layer bottom depths','m',[.30,.60,.90,1.20],'Increasing depths; one value per soil layer.'],
  ['soil_fc','Field capacity','m³/m³',[.16,.151,.112,.053],'One fraction per layer, in depth order.'],
  ['soil_wp','Wilting point','m³/m³',[.065,.057,.036,.009],'Each value must be less than field capacity.'],
  ['profile_depletion_initial_mm','Initial profile depletion','mm',0,'Zero starts the profile at field capacity.'],
  ['assimilate_observations','Assimilate measured storage','',true,'Reset end-of-day storage when complete observations exist.']]},
 {title:'Crop development',subtitle:'Stage lengths, basal coefficients, canopy and roots',open:true,fields:[
  ['stage_days','Stage lengths','days',[30,50,50,37],'Initial, development, mid-season, late-season.'],
  ['kcb_initial','Initial basal Kcb','',.15],['kcb_mid','Mid-season basal Kcb','',1.15],['kcb_end','End basal Kcb','',.15],
  ['height_max_m','Maximum crop height','m',3.6],['climate_adjustment_height_m','Climate-adjustment height','m',2.5],
  ['root_min_m','Initial root depth','m',.1],['root_max_m','Maximum root depth','m',1.2,'The engine caps rooting depth at the configured profile.'],
  ['mad','Management allowed depletion','fraction',[.60,.45,.45,.60],'Initial, development, mid-season, late-season.']]},
 {title:'Surface evaporation & runoff',subtitle:'Surface storage, wetting, antecedent conditions and reference ET',fields:[
  ['tew_mm','Total evaporable water','mm',12.75],['rew_mm','Readily evaporable water','mm',10],
  ['surface_depletion_initial_mm','Initial surface depletion','mm',0],['wetted_fraction','Wetted fraction','fraction',1],
  ['cn','Curve numbers','',[46.02,67,83.41],'Dry, normal and wet antecedent conditions.'],
  ['antecedent_threshold_mm','Antecedent thresholds','mm',[36,53],'Five preceding days of rain + irrigation.'],
  ['albedo','Reference albedo','fraction',.23],['kcmax_wind_factor','Kcmax wind factor','',.9]]}
];
function makeUpload(role) {
 const s = schema[role];
 return `<div class="upload-card" data-drop="${role}"><div><div class="upload-title">${s.title}<span class="${s.required?'required':'optional'}-tag">${s.required?'REQUIRED*':'OPTIONAL'}</span></div><p>${s.description}</p></div><label class="choose-file">Choose file<input type="file" data-file="${role}" accept="${s.accept||'.csv,.xlsx'}" aria-label="Upload ${s.title}"></label><div class="file-detail" id="file-${role}"></div></div>`;
}
$('workbookCard').innerHTML = makeUpload('workbook');
$('uploadCards').innerHTML = ['weather','irrigation','nitrate','moisture','plots'].map(makeUpload).join('');
$('rawExtraCards').innerHTML = ['collection_calendar','run_config'].map(makeUpload).join('');
$('guideSchemas').innerHTML = ['weather','irrigation','nitrate','moisture','plots'].map(r=>`<div class="schema-row"><strong>${schema[r].title}</strong><code>${esc(schema[r].columns)}</code></div>`).join('');
function renderParameters() {
 $('parameterGroups').innerHTML = groups.map(g=>`<details class="card" ${g.open?'open':''}><summary><div>${g.title}<small>${g.subtitle}</small></div></summary><div class="form-grid">${g.fields.map(([key,label,unit,value,help])=>`<label>${label}${unit?` <span class="unit">${unit}</span>`:''}${typeof value==='boolean'?`<select id="p-${key}"><option value="true" ${value?'selected':''}>Yes</option><option value="false" ${!value?'selected':''}>No</option></select>`:`<input id="p-${key}" ${Array.isArray(value)?'type="text"':'type="number" step="any"'} value="${Array.isArray(value)?value.join(', '):value}" required>`}${help?`<span class="parameter-help">${help}</span>`:''}</label>`).join('')}</div></details>`).join('');
}
renderParameters();
function showView(view) {
 document.querySelectorAll('.view').forEach(el=>el.classList.toggle('hidden',el.id!==`view-${view}`));
 document.querySelectorAll('.nav-item').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);if(el.dataset.view===view)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});
 if(view==='review') renderReview();
 window.scrollTo({top:0,behavior:'instant'});
}
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
document.querySelectorAll('[data-next]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.next)));
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{
 if(state.busy)return;
 state.mode=b.dataset.mode;
 document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('selected',x===b));
 $('tableInputs').classList.toggle('hidden',state.mode!=='tables');$('rawInputs').classList.toggle('hidden',state.mode!=='raw');
 $('dateVerifiedLabel').classList.toggle('hidden',state.mode==='raw');$('unitsLabel').classList.toggle('hidden',state.mode==='raw');
 invalidateResults();
}));
function fileSize(n){return n>1048576?`${(n/1048576).toFixed(1)} MB`:`${Math.max(1,Math.round(n/1024))} KB`;}
function setFile(role,file){
 if(state.busy)return;
 if(file){const ext=file.name.split('.').pop().toLowerCase();const allowed=role==='run_config'?['json']:role==='collection_calendar'?['csv']:['csv','xlsx'];if(!allowed.includes(ext)){alert(`Please choose ${allowed.join(' or ')} for ${schema[role].title}.`);return;}state.files[role]=file;}else delete state.files[role];
 const el=$(`file-${role}`),card=el.closest('.upload-card');card.classList.toggle('loaded',!!file);
 el.innerHTML=file?`<span>${esc(file.name)} · ${fileSize(file.size)}</span><button class="remove-file" aria-label="Remove ${schema[role].title}">×</button>`:'';
 if(file)el.querySelector('button').onclick=()=>{setFile(role,null);document.querySelector(`[data-file="${role}"]`).value='';};
 invalidateResults();updateReadiness();
}
document.querySelectorAll('[data-file]').forEach(el=>el.addEventListener('change',()=>setFile(el.dataset.file,el.files[0])));
document.querySelectorAll('[data-drop]').forEach(el=>{el.addEventListener('dragover',e=>{e.preventDefault();el.classList.add('dragover');});el.addEventListener('dragleave',()=>el.classList.remove('dragover'));el.addEventListener('drop',e=>{e.preventDefault();el.classList.remove('dragover');if(e.dataTransfer.files[0])setFile(el.dataset.drop,e.dataTransfer.files[0]);});});
$('rawFolder').addEventListener('change',()=>{
 state.rawFiles=Array.from($('rawFolder').files).filter(f=>{
  const p=f.webkitRelativePath;
  return /\/Weather_data\/[^/]+\.csv$/i.test(p)||/\/Master_fielddata\/(Master_Irrigation|Master_PR2_SM|Nitrate_Concentrations_RAW_Lab)\.xlsx$/i.test(p)||/\/Experimental_protocol\/[^/]+\.xlsx$/i.test(p)||/\/plot_maps\/[^/]+\.(csv|xlsx)$/i.test(p)||p.split('/').length===2&&/\.(csv|xlsx)$/i.test(p);
 });
 $('folderStatus').textContent=state.rawFiles.length?`${state.rawFiles[0].webkitRelativePath.split('/')[0]} · ${state.rawFiles.length} relevant files selected · ${fileSize(state.rawFiles.reduce((a,f)=>a+f.size,0))}`:'No supported raw inputs found. Choose the Raw_data_NNI folder containing Weather_data and Master_fielddata.';
 invalidateResults();updateReadiness();
});
function updateReadiness(){
 $('inputDot').classList.toggle('hidden',state.mode==='tables'?!((state.files.weather&&state.files.irrigation)||state.files.workbook):!(state.rawFiles.length||$('raw_root').value.trim()));
}
function invalidateResults(){
 if(state.results&&!state.busy){state.results=null;$('resultsContent').classList.add('hidden');$('emptyResults').classList.remove('hidden');$('downloadAll').classList.add('hidden');$('resultsDot').classList.add('hidden');$('resultSubtitle').textContent='Inputs changed. Run the analysis to generate updated results.';clearDownloads();}
}
document.querySelectorAll('#view-inputs input:not([type=file]),#view-inputs select').forEach(el=>el.addEventListener('change',()=>{invalidateResults();updateReadiness();}));
$('parameterGroups').addEventListener('change',invalidateResults);
$('resetParameters').onclick=()=>{renderParameters();invalidateResults();};
$('guideLink').onclick=e=>{e.preventDefault();$('guideDialog').showModal();};$('closeGuide').onclick=()=>$('guideDialog').close();
$('guideDialog').addEventListener('click',e=>{if(e.target===$('guideDialog'))$('guideDialog').close();});
function parameters(){
 const p={};for(const g of groups)for(const [key,label,unit,value] of g.fields){const raw=$(`p-${key}`).value;if(raw.trim()==='')throw Error(`${label} is required.`);p[key]=Array.isArray(value)?raw.split(',').map(v=>v.trim()===''?NaN:Number(v.trim())):typeof value==='boolean'?raw==='true':Number(raw);const nums=Array.isArray(p[key])?p[key]:[p[key]];if(nums.some(n=>typeof n==='number'&&!Number.isFinite(n)))throw Error(`${label}: enter valid numbers separated by commas.`);}return p;
}
function requestConfig(){
 return {mode:state.mode,dataset:$('dataset').value.trim(),site:$('site').value.trim(),planting_date:$('planting_date').value,end_date:$('end_date').value,
 latitude_deg:Number($('latitude_deg').value),elevation_m:Number($('elevation_m').value),wind_height_m:Number($('wind_height_m').value),
 nitrate_basis:$('nitrate_basis').value,concentration_units:$('concentration_units').value,concentration_method:$('concentration_method').value,
 blank_irrigation_policy:$('blank_irrigation_policy').value,irrigation_complete:$('irrigation_complete').checked,collection_dates_verified:$('collection_dates_verified').checked,
 sites:Array.from(document.querySelectorAll('[name=rawSite]:checked')).map(x=>x.value),years:Array.from(document.querySelectorAll('[name=rawYear]:checked')).map(x=>Number(x.value)),
 raw_root:state.local?$('raw_root').value.trim():null,sensitivity:$('sensitivity').checked,parameters:parameters()};
}
function missingInputs(){
 const missing=[];
 if(state.mode==='tables'){
  if(!state.files.workbook){for(const role of ['weather','irrigation'])if(!state.files[role])missing.push(`Upload ${schema[role].title.toLowerCase()}.`);}
  for(const [id,label] of [['site','a site name'],['dataset','a dataset name'],['planting_date','a planting date'],['end_date','an end date']])if(!$(id).value.trim())missing.push(`Enter ${label}.`);
  for(const id of ['latitude_deg','elevation_m','wind_height_m'])if(!$(id).value.trim())missing.push(`Enter ${id.replace(/_/g,' ')}.`);
  if(!$('irrigation_complete').checked)missing.push('Confirm that the irrigation table is a complete event log.');
  if($('end_date').value<$('planting_date').value)missing.push('Analysis end must be on or after planting.');
 }else{
  if(!state.rawFiles.length&&!(state.local&&$('raw_root').value.trim()))missing.push('Choose a raw input folder.');
  if(!document.querySelector('[name=rawSite]:checked')||!document.querySelector('[name=rawYear]:checked'))missing.push('Choose at least one site and year.');
 }
 return missing;
}
function renderReview(){
 const missing=missingInputs();let p;try{p=parameters();}catch(e){missing.push(e.message);p={};}
 const row=(k,v,cls='')=>`<div><dt>${esc(k)}</dt><dd class="${cls}">${esc(v)}</dd></div>`;
 const inputs=state.mode==='tables'?Object.entries(state.files).filter(([k])=>!['run_config','collection_calendar'].includes(k)):Object.entries(state.files).filter(([k])=>['run_config','collection_calendar'].includes(k));
 $('reviewContent').innerHTML=`${missing.length?`<div class="notice"><strong>Before running</strong><br>${missing.map(esc).join('<br>')}</div>`:'<div class="notice" style="background:#f0f6eb;border-color:#d6e4c9;color:#5f7e4d">Required selections are present. Table contents, duplicate records, date coverage and model settings will be checked when you run.</div>'}<div class="review-grid"><div class="card"><h2>Study & inputs</h2><dl class="review-list">${row('Input format',state.mode==='tables'?'Prepared tables':'Original raw-data folder')}${state.mode==='tables'?row('Study',`${$('dataset').value} · ${$('site').value}`)+row('Period',`${$('planting_date').value} → ${$('end_date').value}`)+row('Station',`${$('latitude_deg').value}° · ${$('elevation_m').value} m`):row('Folder',state.rawFiles.length?`${state.rawFiles.length} selected files`:$('raw_root').value||'Missing')+row('Sites / years',Array.from(document.querySelectorAll('[name=rawSite]:checked,[name=rawYear]:checked')).map(x=>x.value).join(', '))}${inputs.map(([role,file])=>row(schema[role].title,file.name)).join('')}</dl></div><div class="card"><h2>Calculation settings</h2><dl class="review-list">${row('Profile depth',p.soil_bottom_m?`${p.soil_bottom_m.at(-1)} m`:'Check settings')}${row('Crop stages',p.stage_days?`${p.stage_days.join(' / ')} days`:'Check settings')}${row('Analyte',$('nitrate_basis').selectedOptions[0].text)}${row('Concentration method',$('concentration_method').selectedOptions[0].text)}${row('Blank irrigation',$('blank_irrigation_policy').selectedOptions[0].text)}${row('Data handling',state.local?'Local Python server':'In this browser tab')}</dl></div></div>`;
 $('runButton').disabled=state.busy||missing.length>0;
}
function logProgress(message){$('progressTitle').textContent=message;$('progressLog').textContent+=message+'\n';$('progressLog').scrollTop=$('progressLog').scrollHeight;}
function setBusy(busy){
 state.busy=busy;$('runButton').disabled=busy;$('exampleButton').disabled=busy;$('resetButton').disabled=busy;$('resetParameters').disabled=busy;
 document.querySelectorAll('input,select,[data-mode],.remove-file').forEach(el=>el.disabled=busy);
 $('progressPanel').classList.toggle('hidden',!busy);
}
function clearDownloads(){for(const value of Object.values(state.downloads))URL.revokeObjectURL(value);state.downloads={};}
function addDownload(key,bytes,type){if(state.downloads[key])URL.revokeObjectURL(state.downloads[key]);state.downloads[key]=URL.createObjectURL(new Blob([bytes],{type}));}
function download(key,name){const url=state.downloads[key];if(!url)return;const a=document.createElement('a');a.href=url;a.download=name;a.click();}
function done(data,binaries){
 clearDownloads();state.results=data;if(binaries){for(const [key,bytes] of Object.entries(binaries))addDownload(key,bytes,key==='zip'?'application/zip':key==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/pdf');}
 setBusy(false);$('errorPanel').classList.add('hidden');$('emptyResults').classList.add('hidden');$('resultsContent').classList.remove('hidden');$('downloadAll').classList.remove('hidden');$('resultsDot').classList.remove('hidden');
 $('resultSubtitle').textContent=`${data.plot_count} plot${data.plot_count===1?'':'s'} · ${data.daily_rows.toLocaleString()} daily records · generated from your supplied inputs`;
 $('checkCount').textContent=`${data.checks.length} checks`;
 const keys=[...new Set(data.plot_year.map(r=>`${r.Dataset} / ${r.Site} / ${r.Year}`))];$('resultFilter').innerHTML='<option value="all">All results</option>'+keys.map(k=>`<option>${esc(k)}</option>`).join('');
 $('checksList').innerHTML=data.checks.map(c=>`<div class="quality-item"><span class="pass-check">${c.Passed?'✓':'×'}</span><div>${esc(c.Check)}<p>${esc(c.Details)}</p></div></div>`).join('');
 $('issuesList').innerHTML=data.issues.length?data.issues.map(i=>`<div class="quality-item"><div><span class="quality-scope">${esc(i.scope||'Review')}</span>${esc(i.message)}</div></div>`).join(''):'<p>No additional data-quality notes were recorded.</p>';
 $('dailyTitle').textContent=`Daily water budget · plot ${data.daily_plot}`;
 resetExplorer(data);renderResults();setResultTab('plots');showView('results');
}
function failure(error){setBusy(false);$('errorPanel').classList.remove('hidden');$('errorPanel').textContent=error;showView('review');}
async function fileBytes(file){return new Uint8Array(await file.arrayBuffer());}
async function collectUploads(){
 const uploads=[];
 const roles=state.mode==='tables'?['workbook','weather','irrigation','nitrate','moisture','plots']:['collection_calendar','run_config'];
 for(const role of roles){const file=state.files[role];if(file)uploads.push({role,name:file.name,bytes:await fileBytes(file)});}
 if(state.mode==='raw'&&state.rawFiles.length)for(const file of state.rawFiles)uploads.push({role:'raw',name:file.webkitRelativePath.split('/').slice(1).join('/'),bytes:await fileBytes(file)});
 return uploads;
}
$('runButton').onclick=async()=>{
 if(state.busy)return;
 let config;try{const missing=missingInputs();if(missing.length)throw Error(missing.join('\n'));config=requestConfig();}catch(e){failure(e.message);return;}
 const run=++state.runGeneration;
 $('errorPanel').classList.add('hidden');$('progressLog').textContent='';clearDownloads();state.results=null;$('resultsContent').classList.add('hidden');$('emptyResults').classList.remove('hidden');$('downloadAll').classList.add('hidden');$('resultsDot').classList.add('hidden');setBusy(true);logProgress('Reading your selected files…');
 try{
  const uploads=await collectUploads();
  if(!currentRun(run))return;
  if(state.local){await runLocal(config,uploads,run);return;}
  if(!state.worker){
   const worker=new Worker('worker.js?v=20261030-controls6',{type:'module'});state.worker=worker;
   worker.onmessage=e=>{if(state.worker!==worker)return;const m=e.data;if(m.type==='daily'||m.type==='daily_error'){receiveDaily(m);return;}if(!currentRun(m.run)||!state.busy)return;if(m.type==='progress')logProgress(m.message);if(m.type==='result')done(m.result,m.binaries);if(m.type==='error')failure(m.message);};
   worker.onerror=e=>{if(state.worker!==worker)return;worker.terminate();state.worker=null;if(state.busy)failure('The browser calculation stopped. Try again, or use the local Python version for large datasets. '+e.message);};
  }
  state.worker.postMessage({type:'run',run,config,uploads},uploads.map(f=>f.bytes.buffer));
 }catch(e){if(currentRun(run))failure(e.message);}
};
function currentRun(run){return run===state.runGeneration;}
async function cancelLocalJob(id){if(id)await fetch(`/api/jobs/${id}/cancel`,{method:'POST'}).catch(()=>{});}
$('cancelButton').onclick=async()=>{
 const job=state.job;++state.runGeneration;
 if(state.worker){state.worker.terminate();state.worker=null;}
 if(state.poll)clearTimeout(state.poll);state.poll=null;state.job=null;
 setBusy(false);$('errorPanel').classList.remove('hidden');$('errorPanel').textContent='Analysis cancelled. Your input selections are still available.';
 if(state.local&&job)await cancelLocalJob(job);
};
function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
async function runLocal(config,uploads,run=state.runGeneration){
 const response=await fetch('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config,uploads:uploads.map(f=>({role:f.role,name:f.name,data:toBase64(f.bytes)}))})});
 if(!currentRun(run)){const abandoned=await response.json().catch(()=>({}));if(abandoned.id)await cancelLocalJob(abandoned.id);return;}
 const body=await response.json();
 if(!currentRun(run)){if(body.id)await cancelLocalJob(body.id);return;}
 if(!response.ok)throw Error(body.error||'Cannot start the analysis.');state.job=body.id;
 let seen=0;
 async function poll(){
  if(!currentRun(run))return;state.poll=null;
  try{
   const response=await fetch(`/api/jobs/${body.id}`);if(!currentRun(run))return;
   const job=await response.json();if(!currentRun(run))return;
   if(!response.ok)throw Error(job.error||'Cannot read analysis status.');
   for(const message of (job.progress||[]).slice(seen))logProgress(message);seen=(job.progress||[]).length;
   if(job.status==='done'){state.job=null;state.completedJob=body.id;done(job.result);for(const [key,name] of [['zip','ixn_results.zip'],['xlsx','results/results.xlsx'],['pdf','results/plot_year_results.pdf']])state.downloads[key]=`/api/jobs/${body.id}/files/${name}`;}
   else if(job.status==='error'){state.job=null;failure(job.error||'Analysis failed.');}
   else if(state.busy)state.poll=setTimeout(poll,800);
  }catch(e){if(currentRun(run))failure(e.message);}
 }
 await poll();
}
function filteredRows(){const key=$('resultFilter').value;return state.results.plot_year.filter(r=>(key==='all'||`${r.Dataset} / ${r.Site} / ${r.Year}`===key)&&($('irrigationFilter').value==='all'||String(r.Irrigation_treatment)===$('irrigationFilter').value)&&($('nitrogenFilter').value==='all'||String(r.Nitrogen_treatment)===$('nitrogenFilter').value));}
const number=(n,d=2)=>n===null||n===undefined||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
function renderResults(){
 if(!state.results)return;const rows=filteredRows();
 const mean=key=>{const v=rows.map(r=>r[key]).filter(v=>v!==null&&v!==undefined);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;};
 $('metricCards').innerHTML=[['Reported-analyte load','Load_kg_ha','kg/ha','Mean per plot · sampled intervals','accent'],['WB_ETa + fallback','WB_ETa_mm','mm',`${rows.filter(r=>r.WB_days>0).length}/${rows.length} plots with measured WB coverage`,''],['Modeled drainage','Drainage_mm','mm','Mean per plot · full model period',''],['Modeled ET','Model_ETa_mm','mm','Mean per plot · full model period','']].map(([label,key,unit,note,cls])=>`<div class="metric-card ${cls}"><div class="metric-label">${label}</div><div class="metric-value">${number(mean(key),key==='Load_kg_ha'?2:1)}<small>${unit}</small></div><p>${note}</p></div>`).join('');
 drawXYChart(rows);
 renderSiteET(rows,state.results);
 renderTreatmentMatrix(rows,'Model_ETa_mm',siteETMatrix,true);
 const columns=[['Plot','Plot'],['Site','Site'],['Year','Year'],['Irrigation_treatment','Irrigation'],['Nitrogen_treatment','Nitrogen'],['Load_kg_ha','Load (kg/ha)'],['WB_ETa_mm','WB_ETa (mm)'],['Model_ETa_mm','ET (mm)'],['Drainage_mm','Drainage (mm)'],['WB_days','Measured WB days'],['Leaching_days','Nitrate coverage days'],['Result_status','Result status']];
 $('resultsTable').innerHTML=`<thead><tr>${columns.map(c=>`<th>${c[1]}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${columns.map(([key])=>`<td>${['Plot','Site','Year','Irrigation_treatment','Nitrogen_treatment','WB_days','Leaching_days','Result_status'].includes(key)?esc(r[key]):number(r[key])}</td>`).join('')}</tr>`).join('')}</tbody>`;
 const csvColumns=Object.keys(rows[0]||{});const quote=v=>`"${String(v??'').replace(/"/g,'""')}"`;const csv=[csvColumns.map(quote).join(','),...rows.map(r=>csvColumns.map(k=>quote(r[k])).join(','))].join('\r\n');addDownload('csv','\uFEFF'+csv,'text/csv;charset=utf-8');renderExplorer(rows);
}
function drawBars(rows,key){
 const valid=rows.filter(r=>r[key]!==null&&Number.isFinite(r[key]));if(!valid.length){$('plotChart').innerHTML='<div class="chart-empty">No observations available for this metric. Missing values are not treated as zero.</div>';return;}
 const width=Math.max(760,rows.length*12),height=275,left=55,bottom=height-42,top=18,max=Math.max(...valid.map(r=>r[key]),0)||1,min=Math.min(0,...valid.map(r=>r[key])),range=max-min||1,span=bottom-top;
 const y=v=>bottom-(v-min)/range*span;const selectedLabel=$('chartMetric').selectedOptions[0].text;const unit=selectedLabel.includes('kg/ha')?'kg/ha':'mm';let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(selectedLabel)} by plot"><title>${esc(selectedLabel)} by plot</title><text x="${left}" y="12" class="axis-unit">${unit}</text>`;
 for(let t=0;t<=4;t++){const value=min+range*t/4;svg+=`<line x1="${left}" y1="${y(value)}" x2="${width-15}" y2="${y(value)}" stroke="#e9eee3"/><text x="${left-10}" y="${y(value)+3}" text-anchor="end">${number(value,1)}</text>`;}
 svg+=`<line x1="${left}" y1="${y(0)}" x2="${width-15}" y2="${y(0)}" stroke="#9dad9c"/>`;
 const palette={I1:'#3d7158',I2:'#b49861',I3:'#8c8b9e',I4:'#77915b'};
 const bw=(width-left-25)/rows.length;rows.forEach((r,i)=>{if(r[key]===null)return;const x=left+i*bw+2,v=r[key],color=palette[r.Irrigation_treatment]||'#527b60';svg+=`<rect x="${x}" y="${Math.min(y(v),y(0))}" width="${Math.max(2,bw-4)}" height="${Math.max(1,Math.abs(y(v)-y(0)))}" rx="2" fill="${color}" opacity=".86"><title>Plot ${esc(r.Plot)} · ${esc(r.Site)} ${r.Year}: ${number(v,3)} ${unit}</title></rect>`;if(i%Math.max(1,Math.ceil(rows.length/14))===0)svg+=`<text x="${x+bw/2}" y="${height-20}" text-anchor="middle">${esc(r.Plot)}</text>`;});
 svg+=`<text x="${(width+left)/2}" y="${height-2}" text-anchor="middle">Plot ID</text></svg>`;
 const treatments=[...new Set(rows.map(row=>String(row.Irrigation_treatment)))].sort();
 const legend=treatments.map(label=>`<span><i style="background:${palette[label]||'#527b60'}"></i>${esc(label)}</span>`).join('');
 $('plotChart').innerHTML=`<div class="chart-key"><span>Irrigation treatment</span>${legend}</div>${svg}`;
}
function drawDaily(rows){
 if(!rows.length)return;const w=880,h=280,left=48,top=18,bottom=245,max=Math.max(1,...rows.flatMap(r=>[r.Rain_mm+r.Irrigation_mm,r.ETa_model_mm,r.Drainage_mm])),x=i=>left+i*(w-left-15)/Math.max(1,rows.length-1),y=v=>bottom-v/max*(bottom-top);
 let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily rainfall, irrigation, modeled ET and drainage in millimeters per day"><title>Daily water fluxes · mm/day</title><text x="${left}" y="12" class="axis-unit">mm/day</text>`;
 for(let i=0;i<5;i++){const v=max*i/4;svg+=`<line x1="${left}" y1="${y(v)}" x2="${w-15}" y2="${y(v)}" stroke="#ebefe5"/><text x="${left-9}" y="${y(v)+3}" text-anchor="end">${number(v,1)}</text>`;}
 const barw=Math.max(1,(w-left-15)/rows.length*.7);for(let i=0;i<rows.length;i++){const r=rows[i];svg+=`<rect x="${x(i)-barw/2}" y="${y(r.Rain_mm+r.Irrigation_mm)}" width="${barw}" height="${bottom-y(r.Rain_mm+r.Irrigation_mm)}" fill="#91b3c3" opacity=".8"><title>${esc(r.Date.slice(0,10))}: water inputs ${number(r.Rain_mm+r.Irrigation_mm)} mm</title></rect>`;}
 for(const [key,color] of [['ETa_model_mm','#3a7863'],['Drainage_mm','#c49343']])svg+=`<polyline fill="none" stroke="${color}" stroke-width="2" points="${rows.map((r,i)=>`${x(i)},${y(r[key])}`).join(' ')}"/>`;
 for(let i=0;i<rows.length;i+=Math.max(1,Math.ceil(rows.length/7)))svg+=`<text x="${x(i)}" y="${h-11}" text-anchor="middle">${esc(rows[i].Date.slice(5,10))}</text>`;
 svg+='</svg>';$('dailyChart').innerHTML=svg;
}
document.querySelector('.tab-group').innerHTML='<button class="selected" data-result-tab="plots">Overview</button><button data-result-tab="explorer">Scientific explorer</button><button data-result-tab="daily">ET & water</button><button data-result-tab="observations">Nitrate & soil</button><button data-result-tab="comparison">Treatments</button><button data-result-tab="data">Data & quality</button>';
function setResultTab(tab){state.resultTab=tab;document.querySelectorAll('[data-result-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.resultTab===tab));for(const name of ['plots','explorer','daily','observations','comparison','data'])$(`results-${name}`).classList.toggle('hidden',tab!==name);const picker=$('plotSelectorRow');if(picker)picker.classList.toggle('hidden',tab!=='daily'&&tab!=='observations'&&tab!=='explorer');}
document.querySelectorAll('[data-result-tab]').forEach(b=>b.onclick=()=>setResultTab(b.dataset.resultTab));
$('resultFilter').onchange=renderResults;$('chartMetric').onchange=()=>state.results&&drawXYChart(filteredRows());
$('downloadAll').onclick=()=>download('zip','ixn_results.zip');$('downloadExcel').onclick=()=>download('xlsx','ixn_results.xlsx');$('downloadPdf').onclick=()=>download('pdf','ixn_plot_year_report.pdf');$('downloadCsv').onclick=()=>download('csv','ixn_plot_year_results.csv');
$('exampleButton').textContent='Load 96-plot demo';
$('exampleButton').onclick=async()=>{
 if(state.busy)return;$('exampleButton').disabled=true;
 try{
  document.querySelector('[data-mode=tables]').click();
  for(const role of Object.keys(state.files))setFile(role,null);
  for(const role of ['weather','irrigation','nitrate','moisture','plots']){const r=await fetch(`templates/example_${role}.csv`);if(!r.ok)throw Error('Could not load example inputs.');setFile(role,new File([await r.blob()],`${role}.csv`,{type:'text/csv'}));}
  $('dataset').value='Synthetic 2022 site-year';$('site').value='Demo research site';$('planting_date').value='2022-05-16';$('end_date').value='2022-10-31';$('latitude_deg').value='45.34399';$('elevation_m').value='287.1216';$('wind_height_m').value='3';$('irrigation_complete').checked=true;$('nitrate_basis').value='NO3-N';$('concentration_units').value='mg/L';$('collection_dates_verified').checked=true;renderParameters();invalidateResults();showView('inputs');
 }catch(e){failure(e.message);}finally{$('exampleButton').disabled=false;}
};
$('resetButton').onclick=()=>{if(state.busy)return;location.reload();};
fetch('/api/capabilities').then(async r=>{if(!r.ok)return;const info=await r.json();if(info.local){state.local=true;$('runtimeBadge').textContent='Local Python engine';$('serverPathBlock').classList.remove('hidden');$('privacyNote').textContent='Files are processed by your local Python server. Your original data stays unchanged.';$('runtimeDescription').textContent='The existing Python engine will validate your inputs and generate the workbook, figures and tables.';}}).catch(()=>{});
