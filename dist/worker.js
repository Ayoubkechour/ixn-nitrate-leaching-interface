/* The browser uses the same Python source as the notebook workflow. */
'use strict';
let runtimePromise;
const progress=message=>self.postMessage({type:'progress',message});
async function runtime(){
 if(!runtimePromise)runtimePromise=(async()=>{
  progress('Loading the scientific runtime (first run can take a minute)…');
  const indexURL=new URL('vendor/pyodide/',self.location.href).href;
  const {loadPyodide}=await import(indexURL+'pyodide.mjs');
  const py=await loadPyodide({indexURL,stdout:progress,stderr:message=>console.warn(message)});
  progress('Loading NumPy, pandas and plotting tools…');
  await py.loadPackage(['numpy','pandas','matplotlib']);
  const sitePackages=py.runPython('import site; site.getsitepackages()[0]');
  for(const name of ['et_xmlfile-2.0.0-py3-none-any.whl','openpyxl-3.1.5-py2.py3-none-any.whl']){
   const response=await fetch(new URL('vendor/'+name,self.location.href));if(!response.ok)throw Error('Cannot load spreadsheet support. Reload the page and try again.');
   py.unpackArchive(await response.arrayBuffer(),'zip',{extractDir:sitePackages});
  }
  py.FS.mkdirTree('/ixn');
  for(const name of ['leaching_model.py','leaching_pipeline.py','leaching_sources.py','leaching_results.py','workbook_validation.py','interface_engine.py']){
   const response=await fetch(new URL('python/'+name,self.location.href));if(!response.ok)throw Error('Cannot load the IXN engine.');py.FS.writeFile('/ixn/'+name,await response.text());
  }
  py.runPython("import sys, os; sys.path.insert(0, '/ixn'); os.environ['MPLBACKEND']='Agg'");
  return py;
 })().catch(error=>{runtimePromise=null;throw error;});
 return runtimePromise;
}
function safeName(name){const parts=name.replace(/\\/g,'/').split('/');if(parts.some(p=>p==='..'||p==='')||name.startsWith('/'))throw Error('Invalid input path.');return parts.join('/');}
self.onmessage=async event=>{
 if(event.data.type==='daily'){
  try{
   const id=String(event.data.id);if(!/^\d+$/.test(id))throw Error('Invalid plot selection.');
   const py=await runtime();
   const rows=JSON.parse(py.FS.readFile(`/run/daily_previews/${id}.json`,{encoding:'utf8'}));
   self.postMessage({type:'daily',id,request:event.data.request,rows});
  }catch(error){self.postMessage({type:'daily_error',request:event.data.request,message:String(error.message||error)});}
  return;
 }
 if(event.data.type!=='run')return;
 try{
  const py=await runtime();
  // A fresh workspace avoids carrying files from a previous analysis into this one.
  py.runPython("import shutil; shutil.rmtree('/run', ignore_errors=True)");py.FS.mkdirTree('/run/inputs');
  const config=event.data.config;config.files={};
  for(const file of event.data.uploads){
   const name=safeName(file.name),path=file.role==='raw'?'/run/raw/'+name:'/run/inputs/'+file.role+'/'+name;
   py.FS.mkdirTree(path.slice(0,path.lastIndexOf('/')));py.FS.writeFile(path,file.bytes);if(file.role!=='raw')config.files[file.role]=path;
  }
  if(config.mode==='raw')config.raw_root='/run/raw';
  py.globals.set('_ixn_request_json',JSON.stringify(config));
  py.globals.set('_ixn_progress',progress);
  const resultJSON=await py.runPythonAsync("import json\nfrom interface_engine import analyze\n_ixn_result, _ixn_archive = analyze(json.loads(_ixn_request_json), '/run', lambda message: _ixn_progress(str(message)))\njson.dumps(_ixn_result, allow_nan=False)");
  const binaries={zip:py.FS.readFile('/run/ixn_results.zip'),xlsx:py.FS.readFile('/run/results/results.xlsx'),pdf:py.FS.readFile('/run/results/plot_year_results.pdf')};
  self.postMessage({type:'result',result:JSON.parse(resultJSON),binaries},Object.values(binaries).map(b=>b.buffer));
  py.runPython("import matplotlib.pyplot as plt; plt.close('all'); import gc; gc.collect()");
 }catch(error){
  let message=String(error.message||error);const lines=message.split('\n').filter(Boolean);const last=lines[lines.length-1];
  if(last&&/Error:|Exception:/.test(last))message=last.replace(/^[A-Za-z]+Error:\s*/,'');
  self.postMessage({type:'error',message});
 }
};
