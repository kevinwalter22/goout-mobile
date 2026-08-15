import https from "node:https";
const token=process.env.GITHUB_TOKEN; const PR=62;
const GATE=/Lint, typecheck|Integration tests \(staging\)|Dependency audit|Secret scan|Security regression/;
function api(m,p,b){const data=b?JSON.stringify(b):null;return new Promise((res,rej)=>{const r=https.request({hostname:"api.github.com",path:p,method:m,headers:{"User-Agent":"euda","Authorization":`Bearer ${token}`,Accept:"application/vnd.github+json",...(data?{"Content-Type":"application/json","Content-Length":Buffer.byteLength(data)}:{})}},x=>{let d="";x.on("data",c=>d+=c);x.on("end",()=>res({s:x.statusCode,b:d?JSON.parse(d):null}));});r.on("error",rej);if(data)r.write(data);r.end();});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms)); const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
(async()=>{
  const pr=(await api("GET",`/repos/kevinwalter22/goout-mobile/pulls/${PR}`)).b; const sha=pr.head.sha;
  for(let i=0;i<45;i++){
    const cr=((await api("GET",`/repos/kevinwalter22/goout-mobile/commits/${sha}/check-runs`)).b.check_runs||[]).filter(c=>GATE.test(c.name));
    const pend=cr.filter(c=>c.status!=="completed"); const fail=cr.filter(c=>c.conclusion&&!["success","neutral","skipped"].includes(c.conclusion));
    if(fail.length){log(`#${PR} GATE FAILED:`,fail.map(f=>`${f.name}:${f.conclusion}`).join(", "));return;}
    if(cr.length&&!pend.length){
      for(let t=0;t<5;t++){const m=await api("PUT",`/repos/kevinwalter22/goout-mobile/pulls/${PR}/merge`,{merge_method:"squash"});if(m.b?.merged){log(`#${PR} MERGED ${m.b.sha?.slice(0,7)}`);return;}log(`attempt ${t+1}: ${m.s}`);await sleep(4000);}
      return;
    }
    log(`#${PR} waiting… ${cr.length} checks, ${pend.length} pending`); await sleep(20000);
  }
  log("timeout");
})();
