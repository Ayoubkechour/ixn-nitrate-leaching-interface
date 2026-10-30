/* Regression checks for cancellation while uploads, job creation or polls wait. */
'use strict';
const assert=require('assert');
const fs=require('fs');
const vm=require('vm');
const source=fs.readFileSync('dist/app.js','utf8');
const start=source.indexOf("$('runButton').onclick=async()=>{");
const end=source.indexOf('function filteredRows()',start);
assert(start>=0&&end>start,'run handlers must be present');
const handlers=source.slice(start,end);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const response=body=>({ok:true,json:async()=>body});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const elements=new Map(),events={done:[],failure:[],progress:[],daily:[],timers:[]},workers=[];
 const state={runGeneration:0,busy:false,local:true,job:null,poll:null,worker:null,downloads:{}};
 const get=id=>{if(!elements.has(id))elements.set(id,{classList:{add(){},remove(){}},textContent:''});return elements.get(id);};
 class Worker{constructor(){this.messages=[];workers.push(this);}postMessage(message){this.messages.push(message);}terminate(){this.terminated=true;}}
 const context={state,$:get,Worker,Uint8Array,JSON,Error,btoa:value=>Buffer.from(value,'binary').toString('base64'),
  missingInputs:()=>[],requestConfig:()=>({}),collectUploads:async()=>[],clearDownloads(){},
  setBusy:value=>{state.busy=value;},logProgress:value=>events.progress.push(value),
  done:value=>{events.done.push(value);state.busy=false;},failure:value=>{events.failure.push(value);state.busy=false;},
  receiveDaily:value=>events.daily.push(value),clearTimeout(){},setTimeout:callback=>{events.timers.push(callback);return events.timers.length;},
  fetch:async()=>{throw Error('Unexpected fetch');}};
 vm.createContext(context);vm.runInContext(handlers,context);
 return {state,events,workers,context,get};
}
async function cancelDuringPost(){
 const h=harness(),post=deferred(),calls=[];
 h.state.runGeneration=1;h.state.busy=true;
 h.context.fetch=(url)=>{calls.push(url);return url==='/api/jobs'?post.promise:Promise.resolve(response({}));};
 const old=h.context.runLocal({},[],1);
 await h.get('cancelButton').onclick();
 h.state.runGeneration++;h.state.busy=true;h.state.job='new-job';
 post.resolve(response({id:'late-job'}));await old;
 assert.deepStrictEqual(calls,['/api/jobs','/api/jobs/late-job/cancel']);
 assert.strictEqual(h.state.job,'new-job');assert.strictEqual(h.state.busy,true);
 assert.strictEqual(h.events.done.length+h.events.failure.length+h.events.progress.length,0);
}
async function cancelDuringPostJson(){
 const h=harness(),json=deferred(),calls=[];
 h.state.runGeneration=1;h.state.busy=true;
 h.context.fetch=url=>{calls.push(url);return Promise.resolve(url==='/api/jobs'?{ok:true,json:()=>json.promise}:response({}));};
 const old=h.context.runLocal({},[],1);await flush();
 await h.get('cancelButton').onclick();h.state.runGeneration++;h.state.busy=true;h.state.job='new-job';
 json.resolve({id:'late-json-job'});await old;
 assert.deepStrictEqual(calls,['/api/jobs','/api/jobs/late-json-job/cancel']);
 assert.strictEqual(h.state.job,'new-job');assert.strictEqual(h.events.done.length+h.events.failure.length,0);
}
async function cancelDuringPoll(){
 const h=harness(),poll=deferred(),calls=[];
 h.state.runGeneration=1;h.state.busy=true;
 h.context.fetch=url=>{calls.push(url);return url==='/api/jobs'?Promise.resolve(response({id:'old-job'})):url==='/api/jobs/old-job'?poll.promise:Promise.resolve(response({}));};
 const old=h.context.runLocal({},[],1);await flush();
 assert.strictEqual(h.state.job,'old-job');await h.get('cancelButton').onclick();
 h.state.runGeneration++;h.state.busy=true;h.state.job='new-job';
 poll.resolve(response({status:'done',result:'stale result',progress:['stale progress']}));await old;
 assert.strictEqual(h.state.job,'new-job');assert.strictEqual(h.events.done.length+h.events.failure.length+h.events.progress.length,0);
 assert(calls.includes('/api/jobs/old-job/cancel'));
}
async function cancelDuringUpload(){
 const h=harness(),uploads=deferred();let calls=0;
 h.context.collectUploads=()=>uploads.promise;h.context.fetch=async()=>{calls++;return response({});};
 const old=h.get('runButton').onclick();await h.get('cancelButton').onclick();
 uploads.resolve([]);await old;
 assert.strictEqual(calls,0);assert.strictEqual(h.workers.length,0);assert.strictEqual(h.events.done.length+h.events.failure.length,0);
}
async function ignoreStaleWorkerMessages(){
 const h=harness();h.state.local=false;
 await h.get('runButton').onclick();const first=h.workers[0],run=first.messages[0].run;
 first.onmessage({data:{type:'result',run:run-1,result:'wrong run'}});
 assert.strictEqual(h.events.done.length,0);
 await h.get('cancelButton').onclick();await h.get('runButton').onclick();
 const current=h.workers[1],next=current.messages[0].run;
 first.onmessage({data:{type:'result',run:next,result:'old worker'}});
 current.onmessage({data:{type:'error',run:run,message:'old error'}});
 assert.strictEqual(h.events.done.length+h.events.failure.length,0);
 current.onmessage({data:{type:'result',run:next,result:'current result'}});
 assert.deepStrictEqual(h.events.done,['current result']);assert.strictEqual(first.terminated,true);
}
(async()=>{await cancelDuringPost();await cancelDuringPostJson();await cancelDuringPoll();await cancelDuringUpload();await ignoreStaleWorkerMessages();console.log('Run cancellation regression checks passed');})().catch(error=>{console.error(error);process.exitCode=1;});
