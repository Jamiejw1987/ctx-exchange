/* ================= CTX LIVE MODE =================
   Loaded only in /exchange/. Swaps the demo's local storage for the real Supabase database:
   real accounts, shared data, live chat and notifications. The screens are the same as the demo. */
(function(){
const sb=window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:"ctx-live-auth"}});
window.CTX_SB=sb;
const L={user:null,role:null,companyId:null,company:null,ready:false,snap:{},rows:{},busy:false,dirty:false,notes:{},applyNotes:{}};
window.CTX_L=L;
const TEAM=["jamie@consumer-talent.com","connor@consumer-talent.com"];
const ago=t=>new Date(t).getTime();
const tfmt=t=>new Date(t).toLocaleString([], {day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
const J=x=>JSON.stringify(x===undefined?null:x);
const blank=o=>{const r={};for(const [k,v] of Object.entries(o)){r[k]=Array.isArray(v)?[]:v&&typeof v==="object"?{}:typeof v==="string"?"":typeof v==="boolean"?false:v}return r};
const BLANK_CO=Object.assign(blank(S.company),{stage:"CHAL",sector:"Food",roles:[],members:[],levels:[],regions:[],retailers:[],cats:[],kw:[],anon:false});
const BLANK_CAND=Object.assign(blank(S.cand),{sector:"Food",lvl:"NAM",region:"Midwest",yrs:0,team:0,open:"Open to the right move",prefStages:["ANY"],prefStage:"ANY",hl:[],retailers:[],prefCats:[],kw:[],agreed:false});
const PRIV_CAND=["name","email","phone","current","hide","blocks","linkedin","agreed"];
const PRIV_CO=["contact","contactTitle","email","phone","alerts_to"];
const OUT_CO=["name","members",...PRIV_CO];
function coPublic(co){const d={};for(const [k,v] of Object.entries(co))if(!OUT_CO.includes(k))d[k]=v;return d}
function coPrivate(co){const d={};PRIV_CO.forEach(k=>{if(co[k]!==undefined)d[k]=co[k]});return d}
function candPublic(c){const d={};for(const [k,v] of Object.entries(c))if(!PRIV_CAND.includes(k)&&k!=="user")d[k]=v;return d}
function candPrivate(c){return {name:c.name||"",phone:c.phone||"",current:c.current||"",hide:String(c.hide||"").split(",").map(x=>x.trim()).filter(Boolean),data:{linkedin:c.linkedin||"",agreed:!!c.agreed,blocks:c.blocks||[]}}}
function toPool(p,priv){const d=p.data||{};const days=(Date.now()-ago(p.updated_at))/864e5;
  return Object.assign({retailers:[],cats:[],kw:[],hl:[],skills:[],career:[],prefCats:[],prefStage:"ANY",stage:"SME",yrs:0,team:0,band:"",notice:"",open:"Open to the right move",headline:"",summary:"",edu:"",work:"",relocate:"",travel:"",lvl:"NAM",region:"National",sector:"Food"},
    d,{id:p.user_id,user:p.ref,base:d.base||d.region||"",cats:d.cats&&d.cats.length?d.cats:(d.prefCats||[]),name:priv&&priv.name?priv.name:p.ref,_named:!!(priv&&priv.name),_email:priv&&priv.email,_phone:priv&&priv.phone,current:priv?priv.current:"",
      isNew:days<7,active:days<7?"Active this week":days<31?"Active this month":"Active recently"})}
function setArr(arr,items){arr.length=0;items.forEach(x=>arr.push(x))}
function sideOf(){return L.role==="pro"?"cand":L.role==="admin"?"admin":"client"}

/* ---------- loading from the database ---------- */
async function q(p){const r=await p;if(r.error){console.error(r.error);throw r.error}return r.data}
async function hydrate(){
  const uid=L.user.id;
  const notes=await q(sb.from("notifications").select("*").order("created_at",{ascending:false}).limit(60));
  S.notes=notes.map(n=>({id:"db"+n.id,dbId:n.id,to:sideOf(),t:n.text,go:n.go,at:ago(n.created_at),read:n.read}));
  L.snap.notes=Object.fromEntries(notes.map(n=>[n.id,n.read]));
  if(L.role==="client")await hydrateClient(uid);else if(L.role==="pro")await hydratePro(uid);else await hydrateAdmin();
  L.ready=true;
}
async function hydrateClient(uid){
  const co=(await q(sb.from("companies").select("*").eq("id",L.companyId)))[0];L.company=co;
  S.company=Object.assign({},BLANK_CO,co.data||{},co.private||{},{name:co.name,members:[]});
  S.terms=co.terms||null;S.agreement=co.terms&&co.terms.agreement||null;
  L.snap.co=J([co.name,coPublic(S.company),coPrivate(S.company)]);L.snap.terms=co.terms?J(Object.assign({},co.terms,{agreement:co.terms.agreement||null})):"null";
  setArr(COMPANIES,[{id:co.id,self:true}]);
  if(co.status!=="approved"){setArr(POOL,[]);S.intros={};S.applies=[];S.shortlist=[];S.decided={};S.log=[];return}
  const [pubs,privs,intros,picks,applies,events]=await Promise.all([q(sb.from("pro_public").select("*")),q(sb.from("pro_private").select("user_id,name,email,phone,current")),
    q(sb.from("intros").select("*").eq("company_id",co.id)),q(sb.from("picks").select("*").eq("company_id",co.id)),q(sb.from("applies").select("*").eq("company_id",co.id)),
    q(sb.from("events").select("*").eq("company_id",co.id).order("at",{ascending:false}).limit(300))]);
  L.ivs=await q(sb.from("interviews").select("*").eq("company_id",co.id).order("created_at"));
  const pv=Object.fromEntries(privs.map(p=>[p.user_id,p]));
  setArr(POOL,pubs.filter(p=>p.user_id!==uid).map(p=>toPool(p,pv[p.user_id])));setArr(DATA,POOL);for(const k in REFID)delete REFID[k];POOL.forEach(p=>REFID[p.user]=p.id);
  const ids=intros.map(i=>i.id);const msgs=ids.length?await q(sb.from("messages").select("*").in("intro_id",ids).order("id")):[];
  S.intros={};L.rows.intros={};
  intros.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));L.closedChats={};
  intros.forEach(i=>{if(i.closed||i.status==="closed"){L.closedChats[i.pro_id]=i;return}const c=POOL.find(p=>p.id===i.pro_id);const cs=i.client_state||{};
    let stage=i.status==="accepted"||i.status==="closed"&&i.accepted_at?2:1;if(stage===2&&c&&c._named)stage=3;if(cs.cstage&&cs.cstage>stage)stage=cs.cstage;
    const review=i.status==="blocked"?"declined":i.status==="declined"?"passed":"approved";
    const ii=Object.assign({},cs,{dbId:i.id,ref:i.ref,stage,review,at:ago(i.created_at),role:i.role,base:i.base,note:i.note,by:"",prior:i.prior||undefined,priorRecent:!!(i.prior&&i.prior.prior==="Yes"),
      acceptedAt:i.accepted_at?ago(i.accepted_at):undefined,closed:i.closed?{by:i.closed.by==="pro"?"pro":"client",at:i.closed.at}:undefined,fromApply:i.from_apply,
      msgs:msgs.filter(m=>m.intro_id===i.id&&(m.audience==="both"||m.audience==="client")).map(m=>Object.assign({},m.payload&&m.payload.f?m.payload:{},{dbId:m.id,f:m.side==="client"?"me":m.side==="pro"?"them":(m.payload&&m.payload.f)||m.side,t:m.body,at:tfmt(m.created_at)}))});
    S.intros[i.pro_id]=ii;L.rows.intros[i.pro_id]={cs:J(cleanCS(ii)),closed:!!i.closed}});
  S.decided={};S.shortlist=[];picks.forEach(p=>{S.decided[p.pro_id]=p.decision;if(p.decision==="keep")S.shortlist.push(p.pro_id)});L.snap.picks=J(S.decided);
  S.applies=applies.filter(a=>a.status!=="withdrawn").map(a=>({id:a.id,cid:a.pro_id,role:a.role,note:a.note,at:ago(a.created_at),status:a.status}));L.snap.applies=Object.fromEntries(S.applies.map(a=>[a.id,a.status]));
  S.log=events.map(e=>({at:new Date(e.at),what:e.what,who:e.who}));
  const td=(await q(sb.from("terms_deals").select("*").eq("company_id",co.id).neq("status","withdrawn").order("created_at",{ascending:false}).limit(1)))[0];
  S.deal=td?{id:td.id,status:td.status,proposed:td.proposed,counter:td.counter,final:td.final,note:td.note,by:td.decided_by,at:td.updated_at}:{status:"none"};
  if(co.terms&&co.terms.tiers&&co.terms.custom)S.deal={status:"agreed",final:co.terms.tiers};
}
const CS_SKIP=["dbId","ref","stage","review","at","msgs","role","base","note","by","prior","priorRecent","acceptedAt","closed","fromApply","_ins"];
function cleanCS(i){const d={};for(const [k,v] of Object.entries(i))if(!CS_SKIP.includes(k))d[k]=v;if(i.stage>=4)d.cstage=i.stage;return d}
async function hydratePro(uid){
  const [pub,priv,cos,intros,applies]=await Promise.all([q(sb.from("pro_public").select("*").eq("user_id",uid)),q(sb.from("pro_private").select("*").eq("user_id",uid)),
    q(sb.from("companies_public").select("*")),q(sb.from("intros").select("*").eq("pro_id",uid).neq("status","blocked")),q(sb.from("applies").select("*").eq("pro_id",uid))]);
  const p=pub[0],v=priv[0]||{};
  S.cand=Object.assign({},BLANK_CAND,p.data||{},{user:p.ref,name:v.name||"",email:v.email||"",phone:v.phone||"",current:v.current||"",hide:(v.hide||[]).join(", "),linkedin:(v.data||{}).linkedin||"",agreed:!!(v.data||{}).agreed,blocks:(v.data||{}).blocks||[]});
  L.snap.cand=J([candPublic(S.cand),candPrivate(S.cand)]);
  const list=cos.map(c=>Object.assign({roles:[],cats:[],stage:"CHAL",sector:"Food",tagline:"",about:"",why:"",hq:"",revenue:"",size:""},c.data||{},{id:c.id,name:c.name||"",anon:!c.name||!!(c.data||{}).anon,signed:c.signed}));
  setArr(COMPANIES,list);setArr(POOL,[]);setArr(DATA,[]);
  S.interest={};S.applied={};L.rows.applies={};
  applies.forEach(a=>{L.rows.applies[a.company_id+"|"+a.role]=a;if(a.status!=="new")return;if(!a.role)S.interest[a.company_id]=ago(a.created_at);else (S.applied[a.company_id]=S.applied[a.company_id]||[]).push(a.role)});
  const ids=intros.map(i=>i.id);const msgs=ids.length?await q(sb.from("messages").select("*").in("intro_id",ids).order("id")):[];
  L.ivs=await q(sb.from("interviews").select("*").eq("pro_id",uid).order("created_at"));
  L.ivFb=Object.fromEntries((await q(sb.from("iv_feedback").select("iv_id").eq("author",uid))).map(f=>[f.iv_id,1]));
  S.creqs=[];S.cthreads={};
  intros.sort((a,b)=>ago(b.created_at)-ago(a.created_at)).forEach(i=>{const co=list.find(c=>c.id===i.company_id)||{name:"A company",anon:true,cats:[],stage:"CHAL"};
    S.creqs.push({id:i.id,coId:i.company_id,at:ago(i.created_at),co:co.name||"",role:i.role,base:i.base,stage:co.stage,hq:co.hq,why:co.why||co.tagline||"",status:i.status==="sent"?"new":i.status==="declined"?"no":"yes",prior:i.prior||undefined,closed:i.closed?(i.closed.by==="pro"?"pro":"client"):undefined,ref:i.ref,fromApply:i.from_apply});
    if(i.accepted_at)S.cthreads[i.id]=msgs.filter(m=>m.intro_id===i.id&&(m.audience==="both"||m.audience==="pro")).map(m=>Object.assign({},m.payload&&m.payload.f?m.payload:{},{dbId:m.id,f:m.side==="pro"?"me":m.side==="client"?"them":(m.payload&&m.payload.f)||m.side,t:m.body,at:tfmt(m.created_at)}))});
}
async function hydrateAdmin(){
  const [cos,mem,profs,pubs,privs,intros,events]=await Promise.all([q(sb.from("companies").select("*").order("created_at",{ascending:false})),q(sb.from("company_members").select("*")),q(sb.from("profiles").select("*")),
    q(sb.from("pro_public").select("*")),q(sb.from("pro_private").select("*")),q(sb.from("intros").select("*")),q(sb.from("events").select("*").order("at").limit(5000))]);
  L.rows={cos,mem,profs,intros,events};L.ivs=await q(sb.from("interviews").select("*").order("created_at"));
  L.rows.deals=await q(sb.from("terms_deals").select("*").neq("status","withdrawn").order("created_at",{ascending:false}));
  S.deal={status:"none"};S.dealReqs=L.rows.deals.map(d=>({id:d.id,status:d.status}));
  const pv=Object.fromEntries(privs.map(p=>[p.user_id,p]));
  setArr(POOL,pubs.map(p=>toPool(p,pv[p.user_id])));setArr(DATA,POOL);for(const k in REFID)delete REFID[k];POOL.forEach(p=>REFID[p.user]=p.id);
  const st={approved:"active",suspended:"suspended",requested:"requested",denied:"denied",declined:"denied",pending:"pending"};
  S.access={};cos.forEach(c=>{S.access[c.id]=Object.assign({},c.access||{},{status:st[c.status]||"active"})});
  S.leads=cos.filter(c=>c.status==="pending").map(c=>({type:"client",status:0}));
  setArr(DCLIENTS,cos.slice(1).map(c=>[c.name,null]));
  S.intros={};S.creqs=[];S.cthreads={};
  setArr(COMPANIES,cos.filter(c=>c.status==="approved").map(c=>Object.assign({roles:[],cats:[]},c.data||{},{id:c.id,name:c.name,signed:!!c.terms})));
}

/* ---------- saving to the database ---------- */
let saveT=null;
save=function(){if(!L.ready)return;L.pending=true;clearTimeout(saveT);saveT=setTimeout(sync,350)};
async function sync(){if(L.busy){L.dirty=true;return}L.busy=true;L.dirty=false;L.pending=false;let changed=false;
  try{
    const uid=L.user.id;
    for(const n of S.notes||[])if(n.dbId&&n.read&&!L.snap.notes[n.dbId]){L.snap.notes[n.dbId]=true;await q(sb.from("notifications").update({read:true}).eq("id",n.dbId))}
    if(L.role==="client"){const co=S.company;
      const cj=J([co.name,coPublic(co),coPrivate(co)]);
      if(cj!==L.snap.co){await q(sb.from("companies").update({name:(co.name||"").trim()||"Unnamed company",data:coPublic(co),private:coPrivate(co)}).eq("id",L.companyId));L.snap.co=cj}
      const tj=S.terms?J(Object.assign({},S.terms,{agreement:S.agreement||null})):"null";
      if(S.terms&&tj!==L.snap.terms){await q(sb.from("companies").update({terms:JSON.parse(tj)}).eq("id",L.companyId));L.snap.terms=tj;changed=true}
      // shortlist and passes
      const want={};Object.keys(S.decided||{}).forEach(k=>{if(POOL.some(p=>p.id===k))want[k]=S.decided[k]});S.shortlist.forEach(k=>{if(POOL.some(p=>p.id===k))want[k]="keep"});
      const had=JSON.parse(L.snap.picks||"{}");
      for(const [k,v] of Object.entries(want))if(had[k]!==v)await q(sb.from("picks").upsert({company_id:L.companyId,pro_id:k,decision:v}));
      for(const k of Object.keys(had))if(!want[k])await q(sb.from("picks").delete().eq("company_id",L.companyId).eq("pro_id",k));
      L.snap.picks=J(want);
      // introductions
      for(const [pid,i] of Object.entries(S.intros)){if(!POOL.some(p=>p.id===pid))continue;
        if(!i.dbId){if(i._ins||i.review==="declined")continue;i._ins=true;
          const row={company_id:L.companyId,pro_id:pid,role:i.role||"",base:i.base||"",note:i.note||"",created_by:uid,from_apply:!!i.fromApply,client_state:cleanCS(i)};
          if(i.fromApply)row.accepted_at=new Date().toISOString();
          const r=await sb.from("intros").insert(row).select().single();
          if(r.error){i._ins=false;console.error(r.error);toast(/duplicate|unique/i.test(r.error.message)?"You already have an open introduction with them":"Couldn't send that. Please try again.");delete S.intros[pid];continue}
          i.dbId=r.data.id;i.ref=r.data.ref;L.rows.intros[pid]={cs:J(cleanCS(i)),closed:false};changed=true;
          if(r.data.status==="blocked"){i.review="declined"}}
        else{const cs=J(cleanCS(i)),row=L.rows.intros[pid]||{};const upd={};
          if(cs!==row.cs)upd.client_state=JSON.parse(cs);
          if(i.closed&&!row.closed&&i.closed.by!=="pro"){upd.closed={by:"client",at:new Date().toISOString()};upd.status="closed"}
          if(Object.keys(upd).length){await q(sb.from("intros").update(upd).eq("id",i.dbId));L.rows.intros[pid]={cs,closed:!!i.closed};changed=true}}
        for(const m of i.msgs||[]){if(m.dbId||m._ins||m.f==="them"||!i.dbId)continue;m._ins=true;const me=m.f==="me";
          const payload=Object.assign({},m);delete payload.t;delete payload._ins;delete payload.at;
          await q(sb.from("messages").insert({intro_id:i.dbId,author:uid,side:me?"client":m.f==="ct"?"ct":"sys",audience:me?"both":"client",body:m.t||"",payload:me?{}:payload}));changed=true}}
      for(const a of S.applies||[])if(L.snap.applies[a.id]&&a.status!==L.snap.applies[a.id]){await q(sb.from("applies").update({status:a.status}).eq("id",a.id));L.snap.applies[a.id]=a.status;changed=true}
    }
    if(L.role==="pro"){const c=S.cand;const cj=J([candPublic(c),candPrivate(c)]);
      if(cj!==L.snap.cand){await q(sb.from("pro_public").update({data:candPublic(c)}).eq("user_id",uid));const pv=candPrivate(c);
        await q(sb.from("pro_private").update({name:pv.name,phone:pv.phone,current:pv.current,hide:pv.hide,data:pv.data,updated_at:new Date().toISOString()}).eq("user_id",uid));L.snap.cand=cj}
      const want={};Object.keys(S.interest||{}).forEach(id=>want[id+"|"]={company_id:id,role:""});Object.entries(S.applied||{}).forEach(([id,ts])=>(ts||[]).forEach(t=>want[id+"|"+t]={company_id:id,role:t}));
      for(const [k,w] of Object.entries(want)){const ex=L.rows.applies[k];
        if(!ex){const r=await sb.from("applies").insert({pro_id:uid,company_id:w.company_id,role:w.role,note:L.applyNotes[k]||""}).select().single();if(!r.error)L.rows.applies[k]=r.data;changed=true}
        else if(ex.status==="withdrawn"){await q(sb.from("applies").update({status:"new",note:L.applyNotes[k]||ex.note||""}).eq("id",ex.id));ex.status="new";changed=true}}
      for(const [k,ex] of Object.entries(L.rows.applies))if(!want[k]&&ex.status==="new"){await q(sb.from("applies").update({status:"withdrawn"}).eq("id",ex.id));ex.status="withdrawn";changed=true}
      for(const [rid,msgs] of Object.entries(S.cthreads||{}))for(const m of msgs){if(m.dbId||m._ins||m.f==="them")continue;m._ins=true;const me=m.f==="me";
        const payload=Object.assign({},m);delete payload.t;delete payload._ins;delete payload.at;
        await q(sb.from("messages").insert({intro_id:rid,author:uid,side:me?"pro":m.f==="ct"?"ct":"sys",audience:me?"both":"pro",body:m.t||"",payload:me?{}:payload}));changed=true}
    }
  }catch(e){console.error(e);toast("Couldn't save just now. Check your connection.")}
  L.busy=false;if(L.dirty)return sync();if(changed)refreshSoon(250);
}

/* ---------- what each side sends that the server doesn't already ---------- */
const _notify=notify;
notify=function(to,t,go){if(!L.ready)return;
  if(to==="admin"){if(/hasn't signed terms|requested access|chatting through you|wants to reveal|isn't ready to reveal|ended the chat|feedback|offer/i.test(t))sb.from("notifications").insert({audience:"admin",text:t,go:go||"dash"}).then(()=>{});return}
  if(to===sideOf()){/* own-side confirmations are shown as toasts already */}};
logEvent=function(what,who){S.log.unshift({at:now(),what,who});if(!L.ready||L.role!=="client")return;
  if(/^Consumer Talent|Introduction sent to|Requested introduction|accepted the request|Message in chat/.test(what))return;
  const m=/Ref CTX-\d+/.exec(what);const pid=m?REFID[m[0]]:null;const i=pid&&S.intros[pid];
  sb.from("events").insert({company_id:L.companyId,pro_id:pid||null,intro_id:i&&i.dbId||null,what:what.replace(/\s*\(CTE-\d+\)/,""),who:who||""}).then(()=>{})};
ensureApplies=function(){if(!S.applies)S.applies=[]};
sendIntroNow=function(k){const i=S.intros[k];if(!i||i.review!=="pending")return;i.review="approved";i.approvedAt=Date.now();save()};
sendInterest=function(k,role,note){L.applyNotes[k.id+"|"+(role||"")]=note||""};
reqCo=function(r){const k=COMPANIES.find(c=>c.id===r.coId)||{anon:true,cats:[]};const anon=!!k.anon||!k.name;return Object.assign({cats:[],stage:r.stage},k,{anon,name:k.name||coDisplay(Object.assign({cats:[]},k,{anon:true}))})};
doReveal=function(id){if(!termsOK()){openTermsGate(()=>refreshSoon(100));return}refreshSoon(100);toast("Names appear as soon as they've accepted and your terms are signed")};

/* ---------- client: company access ---------- */
const ST2={approved:"active",pending:"pending",suspended:"suspended",requested:"requested",denied:"denied",declined:"denied"};
const _accessOf=accessOf;
accessOf=function(key){if(L.role==="client"&&L.company)return Object.assign({},L.company.access||{},{status:ST2[L.company.status]||"active"});if(L.role==="admin")return S.access[key]||{status:"active"};return {status:"active"}};
ensureAccess=function(){};
setAccess=async function(key,st,extra,who){extra=Object.assign({},extra||{});const hw=extra.histWhat;delete extra.histWhat;
  if(L.role==="client"){const acc=Object.assign({},L.company.access||{});acc.req=extra.req;acc.hist=[...(acc.hist||[]),{at:Date.now(),what:hw||st,by:who||""}];
    await q(sb.from("companies").update({status:"requested",access:acc}).eq("id",L.companyId));L.company.status="requested";L.company.access=acc;refreshSoon(50);return}
  if(L.role==="admin"){const co=L.rows.cos.find(c=>c.id===key);if(!co)return;const me=L.user.email.startsWith("connor")?"Connor":"Jamie";if(extra.by)extra.by=me;who=who&&who!=="Consumer Talent"?me:who;const acc=Object.assign({},co.access||{},extra);acc.hist=[...(co.access&&co.access.hist||[]),{at:Date.now(),what:hw||st,by:who||"Consumer Talent"}];
    const status={active:"approved",suspended:"suspended",requested:"requested",denied:"denied"}[st]||st;
    await q(sb.from("companies").update({status,access:acc}).eq("id",key));
    const msg=status==="approved"?(co.status==="pending"?"Welcome to the Consumer Talent Exchange. Your company has been approved, so you can start browsing.":"Your access to the Exchange has been restored. Welcome back."):status==="suspended"?"Your access to the Exchange has been paused. Request access again to continue.":status==="denied"?"Your request for access wasn't approved. Contact Jamie and Connor to talk it through.":"";
    if(msg)await q(sb.from("notifications").insert({audience:"company",company_id:key,text:msg,go:"company"}));
    co.status=status;co.access=acc;S.access[key]=Object.assign({},acc,{status:ST2[status]});refreshSoon(50)}};
// waiting for approval: show what's on the Exchange as counts only (no profiles)
async function drawTeaser(){const {data:t}=await sb.rpc("pool_teaser");const box=app.querySelector(".empty");if(!box||!t||$("#teaser"))return;
  const top=(o,n)=>Object.entries(o||{}).sort((a,b)=>b[1]-a[1]).slice(0,n);const mx=Math.max(1,...Object.values(t.levels||{}),...Object.values(t.regions||{}));
  const bars=(rows,lab)=>rows.map(([k,n])=>`<div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;align-items:center"><span class="small">${esc(lab(k))}</span><b class="small">${n}</b><div style="grid-column:1/-1;height:6px;border-radius:9px;background:var(--line)"><div style="height:100%;width:${Math.round(n/mx*100)}%;border-radius:9px;background:var(--gold,#c8a96a)"></div></div></div>`).join("");
  const d=document.createElement("div");d.id="teaser";d.className="card stack";d.style.cssText="margin-top:18px;gap:12px";
  d.innerHTML=t.total?`<span class="kicker">Waiting for you on the Exchange</span>
    <div class="row" style="gap:28px;align-items:flex-end;flex-wrap:wrap"><div><b style="font-family:var(--display);font-size:44px;line-height:1">${t.total}</b><div class="muted small">professional${t.total===1?"":"s"} on the Exchange</div></div>
      ${t.filtered?`<div><b style="font-family:var(--display);font-size:44px;line-height:1;color:var(--gold,#c8a96a)">${t.match}</b><div class="muted small">match the levels and regions in your profile</div></div>`:`<div class="muted small" style="max-width:240px">Add the levels and regions you hire for to your profile and we'll show how many match.</div>`}</div>
    <div class="grid2" style="gap:18px"><div class="stack" style="gap:8px"><b class="small">By level</b>${bars(top(t.levels,5),k=>LEVELS[k]||k)}</div><div class="stack" style="gap:8px"><b class="small">By region</b>${bars(top(t.regions,5),k=>k)}</div></div>
    <p class="muted small" style="margin:0">Profiles open up as soon as you're approved. Professionals stay anonymous until they accept your request to chat.</p>`
   :`<span class="kicker">Waiting for you on the Exchange</span><p class="muted small" style="margin:0">Professionals are joining now. As soon as you're approved you'll see everyone who matches your roles.</p>`;
  box.appendChild(d)}
const _vLocked=vLocked;
vLocked=function(){const st=L.company&&L.company.status;
  if(st==="pending")return void(app.innerHTML=`<div class="empty" style="max-width:560px;margin:30px auto;text-align:left"><span class="kicker">Almost there</span><h1>Thanks for joining, ${esc((S.company.contact||"").split(" ")[0]||"there")}</h1><p class="muted">Jamie and Connor approve every company personally, usually within a working day. You'll get a notification as soon as ${esc(S.company.name)} is approved. In the meantime you can set up your company profile.</p><div class="row" style="margin-top:12px"><a class="btn" href="#company" id="lkCo">Set up your company profile</a>${contactBtn()}</div></div>`,bindContact(app,"Approval"),$("#lkCo").onclick=e=>{e.preventDefault();L.editAnyway=true;location.hash="company";render()},drawTeaser());
  if(st==="declined")return void(app.innerHTML=`<div class="empty" style="max-width:560px;margin:30px auto;text-align:left"><span class="kicker">Sign-up</span><h1>We couldn't approve this account</h1><p class="muted">Please speak to Jamie and Connor if you think this is a mistake.</p><div class="row">${contactBtn()}</div></div>`,bindContact(app,"Approval"));
  return _vLocked()};

/* ---------- admin: sign-ups, clients, dashboard, protection from real data ---------- */
clientAccounts=function(){const R=L.rows;if(!R.cos)return [];return R.cos.filter(c=>c.status!=="pending"&&c.status!=="declined").map(c=>({key:c.id,co:c.name,stage:(c.data||{}).stage,terms:c.terms?"Terms signed":"Not signed yet",
  members:R.mem.filter(m=>m.company_id===c.id).map(m=>{const p=R.profs.find(x=>x.user_id===m.user_id)||{};return [p.name||p.email||"Member",p.title||"",(c.private||{}).contactTitle?"Leadership":"Team",m.role,"Active"]}),last:0}))};
vInvites=function(){const R=L.rows,P=R.cos.filter(c=>c.status==="pending"),D=R.cos.filter(c=>c.status==="declined");
  const card=(c,dec)=>{const pv=c.private||{};return `<div class="item"><div class="line1"><div class="row" style="flex-wrap:nowrap">${coLogo({name:c.name,logo:(c.data||{}).logo})}<div><b>${esc(c.name)}</b><div class="muted small">${esc(pv.contact||"")}${pv.contactTitle?" · "+esc(pv.contactTitle):""}</div><div class="muted small"><a href="mailto:${esc(pv.email||"")}">${esc(pv.email||"")}</a>${pv.phone?" · "+esc(pv.phone):""} · signed up ${fmt(new Date(c.created_at))}</div></div></div>
    <div class="row">${dec?`<span class="tag">Declined</span><button class="btn quiet sm" data-ok="${c.id}">Approve after all</button>`:`<button class="btn good sm" data-ok="${c.id}">Approve</button><button class="btn line sm" data-no="${c.id}">Decline</button>`}</div></div></div>`};
  app.innerHTML=`<div class="pagehead"><span class="kicker">Consumer Talent · Sign-ups</span><h1>Company sign-ups</h1><p class="muted">Companies that have created an account. Approve one and they can browse and request introductions straight away. Decline and they can't get in. Professionals join automatically, so they don't appear here.</p></div>
  <div class="stack" style="max-width:860px;gap:14px"><div class="card stack"><h2>Waiting for approval <span class="badge num">${P.length}</span></h2><div class="list">${P.map(c=>card(c)).join("")||`<p class="muted">Nobody waiting. New sign-ups appear here and in your notifications.</p>`}</div></div>
  ${D.length?`<div class="card stack"><h2>Declined</h2><div class="list">${D.map(c=>card(c,true)).join("")}</div></div>`:""}
  <div class="card stack" id="acctCard"><div class="row" style="justify-content:space-between;gap:10px"><h2 style="margin:0">All accounts <span class="badge num">${acctRows().length}</span></h2><input type="search" id="acctQ" placeholder="Search name, email or company" style="max-width:280px" value="${esc(L.acctQ||"")}"></div>
    <p class="muted small" style="margin:0">Delete test, spam or unwanted sign-ups. Anyone with an accepted introduction is on the protection record, so they can't be deleted here. Remove a company's access in Client accounts instead.</p>
    <div class="list" id="acctList"></div></div></div>`;
  drawAccts();$("#acctQ").oninput=e=>{L.acctQ=e.target.value;drawAccts()};
  app.querySelectorAll("[data-ok]").forEach(b=>b.onclick=async()=>{b.disabled=true;await setAccess(b.dataset.ok,"active",{histWhat:"Approved"},"Consumer Talent");toast("Approved. They can use the Exchange now.")});
  app.querySelectorAll("[data-no]").forEach(b=>b.onclick=async()=>{b.disabled=true;const co=R.cos.find(c=>c.id===b.dataset.no);await q(sb.from("companies").update({status:"declined"}).eq("id",co.id));co.status="declined";refreshSoon(50);toast("Declined")})};
VIEWS.invites=vInvites;
function acctRows(){const R=L.rows;if(!R.profs)return [];const team=["jamie@consumer-talent.com","connor@consumer-talent.com"];
  return R.profs.filter(p=>!team.includes((p.email||"").toLowerCase())).map(p=>{const cids=R.mem.filter(m=>m.user_id===p.user_id).map(m=>m.company_id);const co=R.cos.find(c=>cids.includes(c.id));
    const prot=R.intros.some(i=>i.accepted_at&&(i.pro_id===p.user_id||cids.includes(i.company_id)));
    return {id:p.user_id,name:p.name||"",email:p.email||"",type:p.role==="client"?"Company":"Professional",co:co?co.name:"",st:co?co.status:"",at:p.created_at,prot}}).sort((a,b)=>new Date(b.at)-new Date(a.at))}
function drawAccts(){const el=$("#acctList");if(!el)return;const qq=(L.acctQ||"").trim().toLowerCase();
  const rows=acctRows().filter(r=>!qq||[r.name,r.email,r.co].join(" ").toLowerCase().includes(qq));
  el.innerHTML=rows.slice(0,100).map(r=>`<div class="item"><div class="line1"><div><b>${esc(r.name||r.email)}</b> <span class="tag">${r.type}</span>${r.co?` <span class="muted small">${esc(r.co)}${r.st&&r.st!=="approved"?" · "+esc(r.st):""}</span>`:""}
      <div class="muted small">${esc(r.email)} · joined ${esc(fmtDay(new Date(r.at)))}</div></div>
    <div class="row">${r.prot?`<span class="tag" title="Has an accepted introduction">On protection record</span>`:`<button class="btn line sm" data-del="${r.id}">Delete</button>`}</div></div></div>`).join("")||`<p class="muted">No accounts${qq?" match that search":" yet"}.</p>`;
  el.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
    if(b.dataset.arm!=="1"){b.dataset.arm="1";b.textContent="Tap again to delete";b.style.color="var(--bad)";b.style.borderColor="var(--bad)";setTimeout(()=>{if(b.isConnected&&b.dataset.arm==="1"){b.dataset.arm="";b.textContent="Delete";b.style.color="";b.style.borderColor=""}},4000);return}
    b.disabled=true;b.textContent="Deleting...";const r=acctRows().find(x=>x.id===b.dataset.del);
    const {error}=await sb.rpc("admin_delete_account",{uid:b.dataset.del});
    if(error){b.disabled=false;b.dataset.arm="";b.textContent="Delete";toast(error.message);return}
    toast(`${r?r.name||r.email:"Account"} deleted`);await hydrate();vInvites();counts()})}
allDeals=function(){const R=L.rows;if(!R.intros)return [];const lastBy={};(R.events||[]).forEach(e=>{if(e.intro_id)lastBy[e.intro_id]=ago(e.at)});
  return R.intros.map(i=>{const c=POOL.find(p=>p.id===i.pro_id);if(!c)return null;const co=R.cos.find(x=>x.id===i.company_id)||{name:"?"};const cs=i.client_state||{};
    let s=i.accepted_at?(co.terms?3:2):1;if(cs.cstage&&cs.cstage>s)s=cs.cstage;let st=[0,0,1,2,3,5][s];if(cs.offerOut&&st<4)st=4;
    let drop=null;if(i.status==="declined")drop={by:"Candidate",why:"Declined the introduction",ago:Math.floor((Date.now()-ago(i.declined_at||i.created_at))/864e5)};
    else if(i.status==="blocked")drop={by:"Consumer Talent",why:"Blocked automatically (their employer)",ago:Math.floor((Date.now()-ago(i.created_at))/864e5)};
    else if(i.closed)drop={by:i.closed.by==="pro"?"Candidate":"Client",why:(i.prior&&i.prior.prior==="Yes"&&cs.priorDecision==="end")?"Interviewed them in the last 6 months":i.closed.by==="pro"?"Decided not to take it forward":"Decided to go separate ways",ago:Math.floor((Date.now()-ago(i.closed.at||i.created_at))/864e5)};
    const v=cs.offer&&cs.offer.summary?+((cs.offer.summary.match(/Package \$([\d,]+)/)||[0,"0"])[1].replace(/,/g,"")):pkg(c);const TT=co.terms&&co.terms.tiers||STD;const R2={pct:v>=200000?TT.t3:v>=100000?TT.t2:TT.t1,custom:!!(co.terms&&co.terms.custom)};const fee=Math.round(v*R2.pct/100);
    const last=Math.floor((Date.now()-(lastBy[i.id]||ago(i.created_at)))/864e5);const alerts=[];if(!drop&&st===2&&last>=7)alerts.push(["warn",`Quiet ${last} days after reveal`]);if(!drop&&st===4)alerts.push(["new","Chase offer decision"]);if(st===5)alerts.push(["hit","Invoice due"]);
    const ivd=(L.ivs||[]).filter(v=>v.intro_id===i.id&&v.starts_at&&(v.status==="booked"||v.status==="held")).map(v=>new Date(v.starts_at).getTime());if(ivd.length&&st<3&&!drop)st=3;
    return {id:i.id,co:co.name,c,st,start:Math.floor((Date.now()-ago(i.created_at))/864e5),last,ivAgo:ivd.length?Math.max(0,Math.floor((Date.now()-Math.max(...ivd))/864e5)):null,live:false,drop,v,pct:R2.pct,custom:R2.custom,fee,wfee:fee,alerts}}).filter(Boolean)};
register=function(){const R=L.rows;if(!R.events)return [];const g={};
  R.events.forEach(e=>{if(!e.pro_id||!e.company_id)return;const k=e.pro_id+"|"+e.company_id;(g[k]=g[k]||{pid:e.pro_id,cid:e.company_id,ev:[]}).ev.push({at:ago(e.at),what:e.what})});
  return Object.values(g).map(r=>{const c=POOL.find(p=>p.id===r.pid);const co=R.cos.find(x=>x.id===r.cid);if(!c||!co)return null;const last=Math.max(...r.ev.map(e=>e.at)),until=plus12(new Date(last)),revealed=r.ev.some(isReveal);
    return {pid:r.pid,co:co.name,ev:r.ev,c,last,until,revealed,on:revealed&&until>new Date()}}).filter(Boolean).sort((a,b)=>b.last-a.last)};
sbToken=async function(){return L.token};

/* ---------- professional: introductions and messages ---------- */
vRequests=function(){
  app.innerHTML=`<div class="pagehead"><span class="kicker">Introductions</span><h1>Companies that want to meet you</h1><p class="muted">It's confidential and never costs you anything. Your current employer can never see you. A company only sees your name once you've accepted and their terms are signed.</p></div>
  <div class="list" style="max-width:760px">${S.creqs.length?S.creqs.map(r=>{const co=reqCo(r);return `<div class="item">
    <div class="line1"><div class="row" style="flex-wrap:nowrap">${co.anon?CTX_LOGO:coLogo(co)}<div><b style="font-size:17px;font-family:var(--display);font-weight:600">${esc(coDisplay(co))}</b><div class="muted small">${STAGES[co.stage]||""}${co.anon?"":co.hq?" · "+esc(co.hq):""} · ${fmt(new Date(r.at))}</div></div></div>
      ${r.status==="new"?`<span class="tag new">New request</span>`:r.status==="yes"?(r.closed?`<span class="tag">Closed</span>`:`<span class="tag hit">You accepted</span>`):`<span class="tag">Declined</span>`}</div>
    ${r.prior?`<p class="muted small">${r.prior.prior==="Yes"?`You told us you interviewed with them in the last six months${r.prior.who?", with "+esc(r.prior.who):""}${r.prior.outcome?" ("+esc(r.prior.outcome)+")":""}.`:"You confirmed you haven't interviewed with them in the last six months."}</p>`:""}
    ${r.role?`<div class="openrole"><b>${esc(r.role)}</b><span class="num">${esc(r.base||"")}</span></div>`:`<p class="small"><b>${esc(coDisplay(co))}</b> would like to have a chat with you.</p>`}
    ${r.why?`<p class="small">${esc(r.why)}</p>`:""}
    ${co.anon?`<div class="protect">${lockIcon}<span>This company has chosen to stay anonymous until you both agree to reveal.</span></div>`:""}
    ${r.status==="new"?`<div class="row"><button class="btn good" data-yes="${r.id}">Accept</button><button class="btn line" data-no="${r.id}">Decline</button></div><p class="muted small" style="margin:0">Accepting counts as an introduction through the Exchange. Please keep all contact with ${esc(coDisplay(co))} here, so everything stays on record.</p>`:
      r.status==="yes"?`<div class="row"><a class="btn sm" href="#messages" data-go="${r.id}">Open conversation</a></div>`:
      r.status==="no"&&!r.closed&&!S.creqs.some(x=>x!==r&&x.co===r.co&&(x.status==="new"||x.status==="yes"))?`<div class="row"><button class="btn line sm" data-reopen="${r.id}">Changed your mind? Accept now</button></div><p class="muted small" style="margin:0">Timing not right before? You can still accept and start chatting. ${esc(coDisplay(co))} will be told you're now open to it.</p>`:""}
  </div>`}).join(""):`<div class="empty"><h2>No requests yet</h2><p class="muted">When a company asks to meet you, it appears here and you get a notification. The more complete your profile, the more you'll be found.</p><a class="btn" href="#candidate">Improve my profile</a></div>`}</div>`;
  app.querySelectorAll("[data-yes]").forEach(b=>b.onclick=()=>priorCheck(b.dataset.yes,async rid=>{const r=S.creqs.find(x=>x.id===rid);
    const up=await sb.from("intros").update({accepted_at:new Date().toISOString(),status:"accepted",prior:r.prior||{prior:"No"}}).eq("id",rid);
    if(up.error){toast("Couldn't accept just now. Please try again.");return}
    await sb.from("messages").insert({intro_id:rid,author:L.user.id,side:"ct",audience:"pro",body:`You accepted ${coDisplay(reqCo(r))}'s request to chat. Your name is only shared with them once their terms are signed. Everything here is logged on the introduction record. Jamie, Consumer Talent`});
    S.cthread=rid;await refresh();location.hash="messages";toast("Accepted. Your conversation is open.")}));
  app.querySelectorAll("[data-no]").forEach(b=>b.onclick=async()=>{await sb.from("intros").update({declined_at:new Date().toISOString(),status:"declined"}).eq("id",b.dataset.no);await refresh();toast("Declined. If the timing changes, you can accept it later from here.")});
  app.querySelectorAll("[data-reopen]").forEach(b=>b.onclick=()=>priorCheck(b.dataset.reopen,async rid=>{const r=S.creqs.find(x=>x.id===rid);
    const up=await sb.from("intros").update({accepted_at:new Date().toISOString(),declined_at:null,status:"accepted",prior:r.prior||{prior:"No"}}).eq("id",rid);
    if(up.error){toast(/duplicate|unique/i.test(up.error.message)?"You already have an open conversation with this company.":"Couldn't accept just now. Please try again.");return}
    await sb.from("messages").insert({intro_id:rid,author:L.user.id,side:"ct",audience:"pro",body:`You accepted ${coDisplay(reqCo(r))}'s request to chat after all. Your name is only shared with them once their terms are signed. Everything here is logged on the introduction record. Jamie, Consumer Talent`});
    S.cthread=rid;await refresh();location.hash="messages";toast("Accepted. Your conversation is open.")}));
  app.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>{S.cthread=b.dataset.go});
};
VIEWS.introductions=vRequests;
vCandMsgs=function(){
  const ids=S.creqs.filter(r=>r.status==="yes"&&S.cthreads[r.id]).map(r=>r.id);
  if(!ids.length){app.innerHTML=`<div class="pagehead"><span class="kicker">Messages</span><h1>Your conversations</h1></div><div class="empty"><h2>No conversations yet</h2><p class="muted">Accept an introduction and you can chat with the company here.</p><a class="btn" href="#introductions">See introductions</a></div>`;return}
  if(!ids.includes(S.cthread))S.cthread=ids[0];
  const r=S.creqs.find(x=>x.id===S.cthread),co=reqCo(r),msgs=S.cthreads[r.id],p=S.cand;
  app.innerHTML=`<div class="pagehead"><span class="kicker">Messages</span><h1>Your conversations</h1><p class="muted">You're shown as <b>${esc(p.user)}</b>. Your name is only shared once the company's terms are signed. Contact details are always blocked in chat.</p></div>
  <div class="chat"><div class="threads">${ids.map(k=>{const rr=S.creqs.find(x=>x.id===k),cc=reqCo(rr),th=S.cthreads[k],last=th[th.length-1];return `<button class="thr ${k===r.id?"on":""}" data-t="${k}"><b>${esc(coDisplay(cc))}</b><div class="muted small">${esc(rr.role||"A chat")}</div>${last?`<div class="small" style="margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(last.t)}</div>`:""}</button>`}).join("")}</div>
    <div class="thread"><div class="thead"><div class="row" style="flex-wrap:nowrap">${co.anon?CTX_LOGO:coLogo(co)}<div><b style="font-family:var(--display);font-size:20px;font-weight:600">${esc(coDisplay(co))}</b><div class="muted small">${r.role?esc(r.role)+(r.base?" · "+esc(r.base):""):"A chat, no specific vacancy"} · ${esc(r.ref||"")}</div></div></div>
      <div class="protect">${lockIcon}<span><b>Private chat.</b> Contact details and links are blocked. ${esc(p.current||"Your employer")} can never see your profile.</span></div></div>
      <div class="msgs" id="msgs">${msgs.map(m=>`<div class="m ${m.f==="sys"||m.f==="blk"?"sys":m.f}">${m.f==="ct"?`<span class="by">Consumer Talent</span>`:m.f==="them"?`<span class="by">${esc(coDisplay(co))}</span>`:""}${esc(m.t)}<span class="by" style="margin:4px 0 0;text-align:right">${esc(m.at||"")}</span></div>`).join("")}</div>
      ${r.closed?`<div class="closedbar">${r.closed==="pro"?"You went separate ways.":"The company decided not to take this forward."} This conversation is closed.</div>`:`<form class="compose" id="cmp"><input type="text" id="cmpT" placeholder="Write a message..." aria-label="Message" autocomplete="off"><button class="btn" type="submit">Send</button></form><div class="row" style="justify-content:flex-end;margin-top:6px"><button type="button" class="btn quiet sm" id="bEnd">Not for me, close this chat</button></div>`}</div></div>`;
  {const pn=ivProPanel(r,co),th=app.querySelector(".thead");if(pn&&th){const d=document.createElement("div");d.className="stack";d.style.gap="8px";d.innerHTML=pn;th.appendChild(d)}bindIvPro(r,co)}
  const box=$("#msgs");box.scrollTop=box.scrollHeight;
  app.querySelectorAll("[data-t]").forEach(b=>b.onclick=()=>{S.cthread=b.dataset.t;vCandMsgs()});
  const f=$("#cmp");if(f)f.addEventListener("submit",async e=>{e.preventDefault();const v=$("#cmpT").value.trim();if(!v)return;
    if(CONTACT_RE.test(v)){msgs.push({f:"sys",t:"Message not sent. Contact details and links are blocked in chat. Use Schedule interview and the details are shared automatically.",at:tnow()});vCandMsgs();sb.from("notifications").insert({audience:"admin",text:`${p.user} tried to share contact details with ${coDisplay(co)}. The message was blocked.`,go:"dash"}).then(()=>{});return}
    $("#cmpT").value="";msgs.push({f:"me",t:v,at:tnow(),_ins:true});vCandMsgs();
    const r2=await sb.from("messages").insert({intro_id:r.id,author:L.user.id,side:"pro",audience:"both",body:v});if(r2.error)toast("Message didn't send. Please try again.");refreshSoon(150)});
  const be=$("#bEnd");if(be)be.onclick=async()=>{if(!confirmInline(be,"Tap again to close this chat"))return;await sb.from("intros").update({closed:{by:"pro",at:new Date().toISOString()},status:"closed"}).eq("id",r.id);await refresh();toast("Chat closed. The company has been told.")};
};
VIEWS.messages=vCandMsgs;
function confirmInline(b,txt){if(b.dataset.armed)return true;b.dataset.armed="1";b.textContent=txt;setTimeout(()=>{delete b.dataset.armed},4000);return false}

/* ---------- interviews: booking inside the chat ---------- */
const IVK={video:"Video interview",phone:"Phone interview",in_person:"In-person interview"};
const myTZ=(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone}catch(e){return ""}})();
const fmtSlot=iso=>new Date(iso).toLocaleString([],{weekday:"short",day:"numeric",month:"short",hour:"numeric",minute:"2-digit",timeZoneName:"short"});
const ivsFor=introId=>(L.ivs||[]).filter(v=>v.intro_id===introId);
const ivActive=introId=>ivsFor(introId).filter(v=>v.status==="proposed"||v.status==="new_times"||v.status==="booked"||(v.status==="held"&&false));
const ivPast=v=>v.starts_at&&new Date(v.starts_at)<new Date();
const ivWhere=v=>v.kind==="video"?(v.location?`Video link: <a href="${esc(/^https?:\/\//i.test(v.location)?v.location:"https://"+v.location)}" target="_blank" rel="noopener">${esc(v.location)}</a>`:""):v.kind==="phone"?esc(v.location||"Phone call"):`Address: ${esc(v.location)}`;
async function ivCall(fn,args,ok){const {error}=await sb.rpc(fn,args);if(error){toast(error.message.replace(/^.*?:\s*/,""));return false}if(ok)toast(ok);await refresh();return true}
function ivICS(v,title){const t=d=>new Date(d).toISOString().replace(/[-:]/g,"").replace(/\.\d+/,"");const e=x=>String(x||"").replace(/\\/g,"\\\\").replace(/[;,]/g,m=>"\\"+m).replace(/\n/g,"\\n");
  const end=new Date(new Date(v.starts_at).getTime()+v.minutes*60000);
  const ics=["BEGIN:VCALENDAR","PRODID:-//Consumer Talent//Exchange//EN","VERSION:2.0","BEGIN:VEVENT",`UID:${v.id}@consumer-talent.com`,`SEQUENCE:${v.seq}`,`DTSTAMP:${t(Date.now())}`,`DTSTART:${t(v.starts_at)}`,`DTEND:${t(end)}`,
    `SUMMARY:${e(title)}`,`LOCATION:${e(v.kind==="phone"?(v.location||"Phone call"):v.location)}`,`DESCRIPTION:${e("Arranged through the Consumer Talent Exchange. "+(v.note||""))}`,"END:VEVENT","END:VCALENDAR"].join("\r\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([ics],{type:"text/calendar"}));a.download="interview.ics";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
function ivReason(title,go){layer.innerHTML=`<div class="scrim" id="irS"><form class="modal stack" id="irF" style="max-width:440px;gap:12px"><h2 style="margin:0">${esc(title)}</h2>
  <label class="field">Reason <small>Optional, shared with the other side</small><textarea id="irT" maxlength="500" style="min-height:80px"></textarea></label>
  <div class="row" style="justify-content:flex-end"><button type="button" class="btn line" id="irX">Back</button><button class="btn" type="submit">${esc(title)}</button></div></form></div>`;
  $("#irX").onclick=()=>layer.innerHTML="";$("#irF").onsubmit=async e=>{e.preventDefault();e.target.querySelector("[type=submit]").disabled=true;const ok=await go($("#irT").value.trim());if(ok)layer.innerHTML="";else e.target.querySelector("[type=submit]").disabled=false}}
// company: suggest times (new interview, or change times on an existing one)
function ivPropose(i,c,v){const pad=n=>String(n).padStart(2,"0"),loc=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const kind=v?v.kind:"video",slots=v&&v.status!=="booked"?v.slots.map(x=>loc(new Date(x))):[];const rnd=v?v.round:ivsFor(i.dbId).filter(x=>x.status!=="cancelled").length+1;
  layer.innerHTML=`<div class="scrim" id="ipS"><form class="modal stack" id="ipF" role="dialog" aria-modal="true" aria-labelledby="ipT" style="max-width:520px;gap:12px">
    <div class="stack" style="gap:4px"><span class="kicker">${v?"Change interview":"Schedule interview"} · Round ${rnd}</span><h2 id="ipT" style="margin:0">Interview with ${esc(c.name||c.user)}</h2>
      <p class="muted small" style="margin:0">Suggest up to three times. They'll pick one, and both of you get a calendar invite with each other's contact details.</p></div>
    <div class="seg" role="group" aria-label="Interview type" style="width:100%">${Object.entries(IVK).map(([k,l])=>`<button type="button" data-k="${k}" aria-pressed="${k===kind}" style="flex:1">${l.replace(" interview","")}</button>`).join("")}</div>
    <div class="stack" style="gap:8px"><b class="small">Times <span class="muted">(your time zone: ${esc(myTZ.replace(/_/g," "))})</span></b>
      ${[0,1,2].map(n=>`<input type="datetime-local" class="ipSl" aria-label="Time option ${n+1}" value="${slots[n]||""}" ${n===0?"required":""}>`).join("")}</div>
    <div class="grid2"><label class="field">Length<select id="ipM">${[30,45,60,90].map(m=>`<option value="${m}" ${(v?v.minutes:45)===m?"selected":""}>${m} minutes</option>`).join("")}</select></label>
      <label class="field"><span id="ipLl">Video link</span><input type="text" id="ipL" value="${esc(v?v.location:"")}" maxlength="500"></label></div>
    <label class="field">Note for them <small>Optional</small><textarea id="ipN" maxlength="1000" style="min-height:70px" placeholder="e.g. You'll meet Sarah, our VP Sales, and Tom from HR.">${esc(v?v.note:"")}</textarea></label>
    <p class="small" id="ipE" style="color:var(--bad);display:none"></p>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn line" id="ipX">Cancel</button><button class="btn" type="submit">${v?"Send new times":"Send times"}</button></div></form></div>`;
  let k=kind;const lbl=()=>{$("#ipLl").textContent=k==="video"?"Video link":k==="phone"?"Phone details (optional)":"Address";$("#ipL").placeholder=k==="video"?"Teams, Zoom or Google Meet link":k==="phone"?"e.g. We'll call your mobile":"Full address"};lbl();
  layer.querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>{k=b.dataset.k;layer.querySelectorAll("[data-k]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));lbl()});
  $("#ipX").onclick=()=>layer.innerHTML="";
  $("#ipF").onsubmit=async e=>{e.preventDefault();const err=m=>{const x=$("#ipE");x.textContent=m;x.style.display="block"};
    const sl=[...layer.querySelectorAll(".ipSl")].map(x=>x.value).filter(Boolean).map(x=>new Date(x));
    if(!sl.length)return err("Add at least one time.");if(sl.some(d=>isNaN(d)||d<new Date(Date.now()+30*60000)))return err("Every time needs to be at least 30 minutes from now.");
    const b=e.target.querySelector("[type=submit]");b.disabled=true;
    const ok=await ivCall("iv_propose",{p_intro:i.dbId,p_kind:k,p_slots:sl.map(d=>d.toISOString()),p_minutes:+$("#ipM").value,p_location:$("#ipL").value.trim(),p_note:$("#ipN").value.trim(),p_iv:v?v.id:null,p_tz:myTZ},v?"New times sent":"Times sent. They'll be told straight away.");
    if(ok)layer.innerHTML="";else b.disabled=false}}
// company: interview cards at the top of the chat
function ivClientPanel(i,c){const list=ivsFor(i.dbId).filter(v=>v.status!=="cancelled"&&!(v.status==="held"));const nm=c.name||c.user;
  return list.map(v=>{const head=`<b>${IVK[v.kind]} · Round ${v.round}</b>`;
    if(v.status==="proposed")return `<div class="card stack ivc" style="padding:12px 14px;gap:6px">${head}<span class="small">Waiting for ${esc(nm)} to choose: ${v.slots.map(x=>esc(fmtSlot(x))).join(" · ")}</span><div class="row"><button class="btn line sm" data-ivchg="${v.id}">Change times</button><button class="btn quiet sm" data-ivcan="${v.id}">Cancel</button></div></div>`;
    if(v.status==="new_times")return `<div class="card stack ivc" style="padding:12px 14px;gap:6px;border-color:var(--warn,#e0b354)">${head}<span class="small">${esc(nm)} asked for different times.${v.new_times_note?` “${esc(v.new_times_note)}”`:""}</span><div class="row"><button class="btn sm" data-ivchg="${v.id}">Suggest new times</button><button class="btn quiet sm" data-ivcan="${v.id}">Cancel</button></div></div>`;
    if(v.status==="booked"&&!ivPast(v))return `<div class="card stack ivc" style="padding:12px 14px;gap:6px;border-color:var(--good,#5bbf8a)">${head}<span><b>Booked: ${esc(fmtSlot(v.starts_at))}</b> · ${v.minutes} minutes</span><span class="small">${ivWhere(v)}</span><div class="row"><button class="btn line sm" data-ivcal="${v.id}">Add to calendar</button><button class="btn line sm" data-ivchg="${v.id}">Reschedule</button><button class="btn quiet sm" data-ivcan="${v.id}">Cancel</button></div></div>`;
    if(v.status==="booked")return `<div class="card stack ivc" style="padding:12px 14px;gap:8px">${head}<b>How did it go?</b><span class="muted small">${esc(fmtSlot(v.starts_at))}. Tell Consumer Talent what happens next.</span><textarea data-ivfb="${v.id}" maxlength="2000" style="min-height:60px" placeholder="Optional notes on the interview (only Consumer Talent sees these)"></textarea><div class="row"><button class="btn sm" data-ivout="${v.id}:next">Another round</button><button class="btn good sm" data-ivout="${v.id}:offer">Making an offer</button><button class="btn line sm" data-ivout="${v.id}:no">Not progressing</button></div></div>`;
    return ""}).join("")}
function bindIvClient(i,c){
  app.querySelectorAll("[data-ivchg]").forEach(b=>b.onclick=()=>ivPropose(i,c,ivsFor(i.dbId).find(v=>v.id===b.dataset.ivchg)));
  app.querySelectorAll("[data-ivcan]").forEach(b=>b.onclick=()=>ivReason("Cancel interview",r=>ivCall("iv_cancel",{p_iv:b.dataset.ivcan,p_reason:r},"Interview cancelled. They've been told.")));
  app.querySelectorAll("[data-ivcal]").forEach(b=>b.onclick=()=>{const v=ivsFor(i.dbId).find(x=>x.id===b.dataset.ivcal);ivICS(v,`${IVK[v.kind]} with ${c.name||c.user}`)});
  app.querySelectorAll("[data-ivout]").forEach(b=>b.onclick=async()=>{const [id,o]=b.dataset.ivout.split(":");if(o==="no"&&!confirmInline(b,"Tap again: this closes the chat"))return;
    const fb=(app.querySelector(`[data-ivfb="${id}"]`)||{}).value||"";b.disabled=true;
    await ivCall("iv_outcome",{p_iv:id,p_outcome:o,p_feedback:fb},o==="offer"?"Great news. Jamie or Connor will be in touch.":o==="next"?"Noted. Schedule the next round when you're ready.":"Noted. The chat has been closed.")})}
// professional: interview cards at the top of the chat
function ivProPanel(r,co){const list=ivsFor(r.id).filter(v=>v.status!=="cancelled");const cn=coDisplay(co);
  return list.map(v=>{const head=`<b>${IVK[v.kind]} · Round ${v.round}</b>`;
    if(v.status==="proposed")return `<div class="card stack ivc" style="padding:12px 14px;gap:8px;border-color:var(--gold,#c8a96a)">${head}<span class="small">${esc(cn)} would like to interview you for ${v.minutes} minutes${v.kind==="in_person"&&v.location?` at ${esc(v.location)}`:""}. Choose a time that suits you (shown in your time zone).</span>${v.note?`<span class="small muted">“${esc(v.note)}”</span>`:""}
      <div class="row" style="flex-wrap:wrap">${v.slots.map(x=>`<button class="btn sm" data-ivpick="${v.id}|${x}">${esc(fmtSlot(x))}</button>`).join("")}</div><div class="row"><button class="btn quiet sm" data-ivnew="${v.id}">None of these work</button></div></div>`;
    if(v.status==="new_times")return `<div class="card stack ivc" style="padding:12px 14px;gap:6px">${head}<span class="small">You asked for different times. ${esc(cn)} will suggest new ones.</span></div>`;
    if(v.status==="booked"&&!ivPast(v))return `<div class="card stack ivc" style="padding:12px 14px;gap:6px;border-color:var(--good,#5bbf8a)">${head}<span><b>Booked: ${esc(fmtSlot(v.starts_at))}</b> · ${v.minutes} minutes</span><span class="small">${ivWhere(v)}</span><div class="row"><button class="btn line sm" data-ivcal="${v.id}">Add to calendar</button><button class="btn quiet sm" data-ivcan="${v.id}">Cancel</button></div></div>`;
    if(ivPast(v)&&!(L.ivFb||{})[v.id]&&!(L.ivFbDone||{})[v.id])return `<div class="card stack ivc" style="padding:12px 14px;gap:8px">${head}<b>How did it go?</b><span class="muted small">Only Consumer Talent sees this. It helps us support you.</span><textarea data-ivpfb="${v.id}" maxlength="2000" style="min-height:60px"></textarea><div class="row"><button class="btn sm" data-ivpsend="${v.id}">Send</button></div></div>`;
    return ""}).join("")}
function bindIvPro(r,co){
  app.querySelectorAll("[data-ivpick]").forEach(b=>b.onclick=async()=>{const [id,slot]=b.dataset.ivpick.split("|");if(!confirmInline(b,"Tap again to confirm "+fmtSlot(slot)))return;b.disabled=true;await ivCall("iv_choose",{p_iv:id,p_slot:slot},"Booked. Calendar invite on its way by email.")});
  app.querySelectorAll("[data-ivnew]").forEach(b=>b.onclick=()=>ivReason("Ask for new times",t=>ivCall("iv_new_times",{p_iv:b.dataset.ivnew,p_note:t},"Asked for new times")));
  app.querySelectorAll("[data-ivcan]").forEach(b=>b.onclick=()=>ivReason("Cancel interview",t=>ivCall("iv_cancel",{p_iv:b.dataset.ivcan,p_reason:t},"Interview cancelled. They've been told.")));
  app.querySelectorAll("[data-ivcal]").forEach(b=>b.onclick=()=>{const v=ivsFor(r.id).find(x=>x.id===b.dataset.ivcal);ivICS(v,`${IVK[v.kind]} with ${coDisplay(co)}`)});
  app.querySelectorAll("[data-ivpsend]").forEach(b=>b.onclick=async()=>{const id=b.dataset.ivpsend,t=(app.querySelector(`[data-ivpfb="${id}"]`)||{}).value||"";if(!t.trim())return toast("Write a few words first");b.disabled=true;
    (L.ivFbDone=L.ivFbDone||{})[id]=1;if(!await ivCall("iv_pro_feedback",{p_iv:id,p_feedback:t.trim()},"Thanks. Sent to Consumer Talent."))delete L.ivFbDone[id];vCandMsgs()})}

/* ---------- company profile: no demo reset; while waiting for approval, saving keeps you on the profile ---------- */
const _vCompany=vCompany;
vCompany=function(){_vCompany();
  const r=$("#reset");if(r)r.remove();
  const na=$("#f_noauth");if(na){const l=document.createElement("a");l.className="btn line sm";l.href="#team";l.textContent="Invite the person who signs";na.replaceWith(l)}
  const pending=L.company&&L.company.status!=="approved",f=$("#coForm");if(!f)return;
  // saving the profile never depends on who signs the terms; that happens on the Terms page
  f.addEventListener("submit",e=>{e.preventDefault();e.stopImmediatePropagation();save();
    if(pending)toast("Profile saved. We'll let you know as soon as you're approved.");else{toast("Profile saved");location.hash="discover"}},{capture:true});
  if(!pending)return;
  const sb2=f.querySelector("button[type=submit]");if(sb2)sb2.textContent="Save profile";
  app.querySelectorAll('a[href="#foryou"],a[href="#discover"]').forEach(x=>x.remove())};
VIEWS.company=vCompany;

/* ---------- terms page: real proposals; signing goes through a teammate ---------- */
const _vTerms=vTerms;
vTerms=function(){_vTerms();
  app.querySelectorAll('a[href="#sign"],#sigResend,#sigCopy').forEach(x=>x.remove());
  const sg=$("#sigSend");if(sg){const a=document.createElement("a");a.className="btn line";a.href="#team";a.textContent="Not authorised? Invite the person who signs";sg.replaceWith(a)}
  const fl=$("#pfile");if(fl){const lab=fl.closest("label");if(lab)lab.innerHTML=`<span>Your own terms document</span><small class="muted" style="font-weight:400">Email it to <a href="mailto:jamie@consumer-talent.com">jamie@consumer-talent.com</a> and mention it below.</small>`}
  const pf=$("#propF");if(pf)pf.addEventListener("submit",async e=>{e.preventDefault();e.stopImmediatePropagation();
    const n=id=>+($("#"+id).value||0),P={t1:n("pt1"),t2:n("pt2"),t3:n("pt3"),repl:n("prepl"),pay:n("ppay"),notes:$("#pnotes").value.trim()};
    const b=pf.querySelector("[type=submit]");b.disabled=true;const {error}=await sb.rpc("terms_propose",{p:P});
    if(error){b.disabled=false;return toast(error.message.replace(/^.*?:\s*/,""))}
    toast("Sent to Jamie and Connor. They'll reply here, usually within a day.");await refresh();vTerms()},{capture:true});
  const d=S.deal;
  // counter-offer from Consumer Talent
  const ac=$("#accC");if(ac)ac.onclick=async()=>{ac.disabled=true;const {error}=await sb.rpc("terms_respond",{p_deal:d.id,p_accept:true});if(error){ac.disabled=false;return toast(error.message)}await refresh();vTerms();toast("Counter-offer accepted. Sign below to put it in place.")};
  const dc=$("#decC");if(dc)dc.onclick=async()=>{const {error}=await sb.rpc("terms_respond",{p_deal:d.id,p_accept:false});if(error)return toast(error.message);await refresh();vTerms()};
  const card=app.querySelector(".cols .card");if(!card)return;
  if(d.status==="countered"&&d.note){const x=document.createElement("p");x.className="small";x.innerHTML=`<b>${esc(d.by||"Consumer Talent")}:</b> ${esc(d.note)}`;(ac?ac.closest(".row"):card).before(x)}
  if(d.status==="declined"&&d.note){const x=document.createElement("p");x.className="small";x.innerHTML=`<b>${esc(d.by||"Consumer Talent")}:</b> ${esc(d.note)}`;card.appendChild(x)}
  // agreed but not signed yet: sign the agreed terms
  if(d.status==="agreed"&&!S.terms){const pf2=$("#propF");if(pf2)pf2.remove();card.innerHTML=`<div class="row" style="justify-content:space-between"><h2>Your status</h2><span class="tag hit">Custom terms agreed</span></div>
    <p>Consumer Talent agreed these terms with ${esc(S.company.name)}${d.note?`: “${esc(d.note)}”`:"."} Sign them to unlock names and chats.</p>${cmpTable(d.final,STD,"Agreed")}
    <form class="stack" id="csF" style="gap:8px"><div class="grid2"><label class="field">Your name<input type="text" id="csN" required value="${esc(S.company.contact||"")}"></label><label class="field">Job title<input type="text" id="csT" required value="${esc(S.company.contactTitle||"")}"></label></div>
      <label class="check"><input type="checkbox" id="csOk"><span>I'm authorised to agree terms for ${esc(S.company.name)}, and I agree to these terms and the Consumer Talent Group contingent terms of business.</span></label>
      <p class="small" id="csE" style="color:var(--bad);display:none"></p><div><button class="btn" type="submit">Sign agreed terms</button></div></form>`;
    $("#csF").onsubmit=e=>{e.preventDefault();const nm=$("#csN").value.trim(),ti=$("#csT").value.trim(),err=t=>{const x=$("#csE");x.textContent=t;x.style.display="block"};
      if(nm.length<2||!ti)return err("Add your name and job title.");if(!$("#csOk").checked)return err("Tick to confirm you're authorised and agree.");
      const by={name:nm,title:ti,email:L.user.email,at:Date.now()};S.terms=Object.assign({},by,{custom:true,tiers:d.final});
      logEvent(`Signed agreed custom terms: ${tierRow(d.final)}`,nm);issueAgreement("Agreed custom terms",{...d.final},by,()=>{counts();vTerms()})}}};
termsOK=function(){return !!S.terms};   // in the live app, terms count once they're signed
// "Would you rather talk about retained search or a project?" box on the Terms page
const _vTerms2=vTerms;
vTerms=function(){_vTerms2();const col=app.querySelector(".cols > .stack");if(!col||$("#rpF"))return;
  const f=document.createElement("form");f.id="rpF";f.className="card stack";f.style.gap="10px";
  f.innerHTML=`<h2 style="margin:0">Prefer retained search or a project?</h2>
    <p class="muted small" style="margin:0">As well as the Exchange, Consumer Talent runs retained searches for senior hires and project-based campaigns for multiple roles. Would you like to discuss those instead?</p>
    <div class="seg" role="group" aria-label="What would you like to discuss" style="width:100%"><button type="button" data-rk="Retained search" aria-pressed="true" style="flex:1">Retained search</button><button type="button" data-rk="Project" aria-pressed="false" style="flex:1">Project</button><button type="button" data-rk="Not sure yet" aria-pressed="false" style="flex:1">Not sure yet</button></div>
    <label class="field">Tell us a little about what you need<textarea id="rpM" maxlength="3000" style="min-height:80px" placeholder="e.g. We're hiring a VP Sales and three regional managers this year."></textarea></label>
    <p class="small" id="rpE" style="color:var(--bad);display:none"></p>
    <div><button class="btn line" type="submit">Send to Jamie and Connor</button></div>`;
  col.appendChild(f);let kind="Retained search";
  f.querySelectorAll("[data-rk]").forEach(b=>b.onclick=()=>{kind=b.dataset.rk;f.querySelectorAll("[data-rk]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)))});
  f.onsubmit=async e=>{e.preventDefault();const m=$("#rpM").value.trim();if(m.length<3){const x=$("#rpE");x.textContent="Add a line about what you need.";x.style.display="block";return}
    const b=f.querySelector("[type=submit]");b.disabled=true;
    const {error}=await sb.from("support_msgs").insert({name:S.company.contact||"",email:L.user.email,company:S.company.name,topic:"Retained or project enquiry",body:`${kind}: ${m}`,payload:{kind}});
    if(error){b.disabled=false;return toast("That didn't send. Please try again.")}
    f.innerHTML=`<h2 style="margin:0">Thanks, we'll be in touch</h2><p class="muted small" style="margin:0">Jamie or Connor will reply to ${esc(L.user.email)}, usually within a working day.</p>`;
    logEvent(`Asked to discuss ${kind.toLowerCase()} instead of standard terms`,S.company.contact||"");toast("Sent to Jamie and Connor")}};
VIEWS.terms=vTerms;

/* ---------- Consumer Talent: terms requests ---------- */
function vTermsLive(){const R=L.rows,deals=R.deals||[];const coN=id=>(R.cos.find(c=>c.id===id)||{}).name||"A company";const coT=id=>(R.cos.find(c=>c.id===id)||{}).terms;
  const lbl={pending:["Needs a decision","new"],countered:["Counter-offer sent","brand"],agreed:["Agreed","hit"],declined:["Declined","tag"]};
  app.innerHTML=`<div class="pagehead"><span class="kicker">Consumer Talent · Terms</span><h1>Terms requests</h1><p class="muted">Companies that want different terms send them here. Accept, send a counter-offer or decline. They can keep browsing while you decide, but can't see names or chat until terms are signed.</p></div>
  <div class="list" style="max-width:860px">${deals.map(d=>{const P=d.proposed||{};const st=lbl[d.status]||["",""];const signed=coT(d.company_id);
    return `<div class="item"><div class="line1"><div><b style="font-size:17px;font-family:var(--display);font-weight:600">${esc(coN(d.company_id))}</b><div class="muted small">${esc(fmtDay(new Date(d.created_at)))}${d.decided_by?` · answered by ${esc(d.decided_by)}`:""}</div></div><span class="tag ${st[1]}">${st[0]}${d.status==="agreed"?(signed?" · signed":" · not signed yet"):""}</span></div>
      ${cmpTable(d.status==="countered"?d.counter:d.status==="agreed"?d.final:P,STD,d.status==="countered"?"Our counter":d.status==="agreed"?"Agreed":"They propose")}
      ${d.status!=="pending"&&P.notes?`<p class="small"><b>Their notes:</b> ${esc(P.notes)}</p>`:""}${d.note?`<p class="small"><b>Your note:</b> ${esc(d.note)}</p>`:""}
      ${d.status==="pending"?`<div class="row"><button class="btn good sm" data-tacc="${d.id}">Accept</button><button class="btn sm" data-tctr="${d.id}">Counter-offer</button><button class="btn line sm" data-tdec="${d.id}">Decline</button></div>`:""}</div>`}).join("")||`<div class="empty"><h2>No terms requests</h2><p class="muted">When a company proposes different terms, it appears here and you get an alert.</p></div>`}</div>`;
  const go=async(id,action,counter,note)=>{const {error}=await sb.rpc("terms_decide",{p_deal:id,p_action:action,p_counter:counter||null,p_note:note||""});if(error)return toast(error.message.replace(/^.*?:\s*/,""));
    toast(action==="accept"?"Accepted. They'll be asked to sign.":action==="counter"?"Counter-offer sent":"Declined. They've been told.");layer.innerHTML="";await refresh();vTermsLive();counts()};
  app.querySelectorAll("[data-tacc]").forEach(b=>b.onclick=()=>{if(!confirmInline(b,"Tap again to accept"))return;b.disabled=true;go(b.dataset.tacc,"accept")});
  app.querySelectorAll("[data-tdec]").forEach(b=>b.onclick=()=>ivReason("Decline proposal",t=>go(b.dataset.tdec,"decline",null,t).then(()=>true)));
  app.querySelectorAll("[data-tctr]").forEach(b=>b.onclick=()=>{const d=deals.find(x=>x.id===b.dataset.tctr),P=d.proposed||STD;
    layer.innerHTML=`<div class="scrim" id="tcS2"><form class="modal stack" id="tcF" style="max-width:520px;gap:12px"><span class="kicker">Counter-offer</span><h2 style="margin:0">${esc(coN(d.company_id))}</h2>
      <div class="grid3"><label class="field">Fee under $100k (%)<input type="number" id="ct1" value="${P.t1}"></label><label class="field">$100–200k (%)<input type="number" id="ct2" value="${P.t2}"></label><label class="field">$200k+ (%)<input type="number" id="ct3" value="${P.t3}"></label>
        <label class="field">Replacement (weeks)<input type="number" id="crepl" value="${P.repl}"></label><label class="field">Payment (days)<input type="number" id="cpay" value="${P.pay}"></label></div>
      <label class="field">Note to them <small>Optional</small><textarea id="cnote" maxlength="500" style="min-height:70px"></textarea></label>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn line" id="tcX">Cancel</button><button class="btn" type="submit">Send counter-offer</button></div></form></div>`;
    $("#tcX").onclick=()=>layer.innerHTML="";$("#tcF").onsubmit=e=>{e.preventDefault();e.target.querySelector("[type=submit]").disabled=true;const n=i=>+$("#"+i).value;
      go(d.id,"counter",{t1:n("ct1"),t2:n("ct2"),t3:n("ct3"),repl:n("crepl"),pay:n("cpay")},$("#cnote").value.trim())}})}
VIEWS.termsadmin=vTermsLive;

/* ---------- Consumer Talent: every interview across the Exchange ---------- */
function vInterviewsLive(){const R=L.rows,ivs=(L.ivs||[]).slice();const coN=id=>(R.cos.find(c=>c.id===id)||{}).name||"A company";
  const pr=id=>R.profs.find(p=>p.user_id===id)||{};const proN=id=>pr(id).name||pr(id).email||"Professional";
  const uk=iso=>new Date(iso).toLocaleString("en-GB",{timeZone:"Europe/London",weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})+" UK";
  const now=Date.now(),t=v=>new Date(v.starts_at||v.slots[0]).getTime();
  const upcoming=ivs.filter(v=>v.status==="booked"&&t(v)>=now).sort((a,b)=>t(a)-t(b));
  const waiting=ivs.filter(v=>v.status==="proposed"||v.status==="new_times").sort((a,b)=>t(a)-t(b));
  const past=ivs.filter(v=>v.status==="held"||(v.status==="booked"&&t(v)<now)).sort((a,b)=>t(b)-t(a));
  const cancelled=ivs.filter(v=>v.status==="cancelled").sort((a,b)=>t(b)-t(a));
  const OUT={next:["Another round","brand"],offer:["Making an offer","hit"],no:["Not progressing",""]};
  const row=(v,mode)=>`<div class="item"><div class="line1"><div><b style="font-size:16px;font-family:var(--display);font-weight:600">${esc(coN(v.company_id))} · ${esc(proN(v.pro_id))}</b>
      <div class="muted small">${IVK[v.kind]} · round ${v.round} · ${v.minutes} min${v.location?` · ${v.kind==="video"?`<a href="${esc(/^https?:/i.test(v.location)?v.location:"https://"+v.location)}" target="_blank" rel="noopener">video link</a>`:esc(v.location)}`:""}</div></div>
      ${mode==="up"?`<span class="tag hit">${esc(uk(v.starts_at))}</span>`:mode==="wait"?`<span class="tag new">${v.status==="new_times"?"Asked for new times":"Waiting for them to pick"}</span>`:mode==="past"?(v.outcome?`<span class="tag ${OUT[v.outcome][1]}">${OUT[v.outcome][0]}</span>`:`<span class="tag">Outcome not recorded</span>`):`<span class="tag">Cancelled by ${v.cancelled&&v.cancelled.by==="pro"?"candidate":"company"}</span>`}</div>
    ${mode==="wait"?`<p class="small muted">Options: ${v.slots.map(x=>esc(uk(x))).join(" · ")}</p>`:mode==="past"||mode==="cx"?`<p class="small muted">${esc(uk(v.starts_at||v.slots[0]))}${mode==="cx"&&v.cancelled&&v.cancelled.reason?` · “${esc(v.cancelled.reason)}”`:""}</p>`:""}
    ${mode==="up"?`<div class="row"><button class="btn line sm" data-ivcal="${v.id}">Add to my calendar</button></div>`:""}</div>`;
  const sec=(h,list,mode,empty)=>`<div class="card stack" style="gap:10px"><div class="row" style="justify-content:space-between"><h2>${h}</h2><span class="tag">${list.length}</span></div>${list.length?`<div class="list">${list.map(v=>row(v,mode)).join("")}</div>`:`<p class="muted small">${empty}</p>`}</div>`;
  app.innerHTML=`<div class="pagehead"><span class="kicker">Consumer Talent · Interviews</span><h1>Interviews</h1><p class="muted">Every interview booked through the Exchange. You and Connor also get each one as a calendar invite in Outlook, updated if it moves or is cancelled. Times are UK time.</p></div>
  <div class="stack" style="max-width:900px;gap:14px">${sec("Coming up",upcoming,"up","No interviews booked yet.")}${sec("Waiting for a time",waiting,"wait","Nothing waiting.")}${sec("Happened",past,"past","None yet.")}${cancelled.length?sec("Cancelled",cancelled,"cx",""):""}</div>`;
  app.querySelectorAll("[data-ivcal]").forEach(b=>b.onclick=()=>{const v=ivs.find(x=>x.id===b.dataset.ivcal);ivICS(v,`${IVK[v.kind]}: ${coN(v.company_id)} and ${proN(v.pro_id)}`)})}
VIEWS.interviews=vInterviewsLive;

/* ---------- team members for companies ---------- */
async function vTeamLive(){const co=S.company;
  if(!L.team){app.innerHTML=`<div class="pagehead"><span class="kicker">Team</span><h1>${esc(co.name||"Your company")} on the Exchange</h1></div><p class="muted">Loading your team...</p>`;}
  const {data,error}=await sb.rpc("team_list");if(error){toast("Couldn't load your team");return}L.team=data;if(view()!=="team")return;
  const T=data,adm=T.admin,signed=termsOK(),approved=L.company&&L.company.status==="approved";
  const row=m=>`<div class="mem"><span class="av">${esc(initials(m.name)||"?")}</span><div class="mi"><b>${esc(m.name)}${m.me?" (you)":""}</b><span>${esc(m.title||"")}${m.title?" · ":""}${m.dept?esc(m.dept)+" · ":""}${esc(m.role)}</span><span>${esc(m.email)}</span></div>
    <div class="ma"><span class="tag hit">Active</span>${adm&&!m.me?(m.role==="Admin"?`<button class="btn line sm" data-tm="${m.id}:remove_admin">Remove admin</button>`:`<button class="btn line sm" data-tm="${m.id}:make_admin">Make admin</button>`)+`<button class="btn quiet sm" data-tm="${m.id}:remove">Remove</button>`:""}</div></div>`;
  const irow=i=>`<div class="mem"><span class="av">${esc(initials(i.name||i.email)||"?")}</span><div class="mi"><b>${esc(i.name||i.email)}</b><span>${esc(i.title||"")}${i.title?" · ":""}${i.dept?esc(i.dept)+" · ":""}${esc(i.role)}</span><span>${esc(i.email)} · invited ${esc(fmtDay(new Date(i.at)))}</span></div>
    <div class="ma"><span class="tag new">Invited</span>${adm?`<button class="btn line sm" data-tcopy="${i.id}">Copy link</button><button class="btn line sm" data-ti="${i.id}:resend">Resend</button><button class="btn quiet sm" data-ti="${i.id}:cancel">Cancel</button>`:""}</div></div>`;
  app.innerHTML=`<div class="pagehead"><span class="kicker">Team</span><h1>${esc(co.name||"Your company")} on the Exchange</h1>
    <p class="muted">Invite colleagues to browse, shortlist, chat and book interviews for their own roles. If an invite email doesn't arrive, use Copy link and send it to them yourself. Everyone works under one company account and one set of terms, and sees the same conversations.</p></div>
  <div class="cols"><div class="stack">
    <div class="card stack"><div class="row" style="justify-content:space-between"><h2>Your team</h2><span class="tag">${T.members.length} active${T.invites.length?` · ${T.invites.length} invited`:""}</span></div>
      <div>${T.members.map(row).join("")}${T.invites.map(irow).join("")}</div></div>
    ${adm&&approved?`<form class="card stack" id="invF" novalidate><h2>Invite a colleague</h2>
      <div class="grid2"><label class="field">Name<input type="text" id="in_n" autocomplete="off"></label><label class="field">Work email<input type="email" id="in_e" autocomplete="off"></label>
        <label class="field">Job title<input type="text" id="in_t" autocomplete="off"></label><label class="field">Department<select id="in_d">${DEPTS.map(d=>`<option>${d}</option>`).join("")}</select></label></div>
      <div class="field">Access<div class="seg" role="group" aria-label="Access" style="width:100%"><button type="button" data-ir="Hiring manager" aria-pressed="true" style="flex:1">Hiring manager</button><button type="button" data-ir="Admin" aria-pressed="false" style="flex:1">Admin</button></div>
        <small class="muted" id="in_rd" style="font-weight:400">${esc(ROLES["Hiring manager"])}</small></div>
      <p class="small" id="in_err" style="color:var(--bad);display:none"></p>
      <div><button class="btn" type="submit">Send invite</button></div></form>`
    :`<div class="card stack"><h2>Invite a colleague</h2><p class="muted small">${!approved?"You can invite colleagues once Consumer Talent has approved your company.":"Only an admin on your account can invite colleagues. Ask one of your admins."}</p></div>`}
  </div>
  <div class="sticky stack">
    <div class="card stack" style="gap:8px"><h3>One set of terms for everyone</h3>
      <p class="small">${signed?"Your signed terms cover every colleague you invite. Nobody needs to sign again.":"When your company signs terms, they cover every colleague you invite. Only someone authorised to sign needs to do it, once."}</p>
      <p class="small muted">Introductions made by any team member count as introductions to ${esc(co.name||"your company")} and its associated companies.</p></div>
    <div class="card stack" style="gap:6px"><h3>Admins and hiring managers</h3><p class="small"><b>Admins</b> manage the team and terms. <b>Hiring managers</b> browse, shortlist, chat and book interviews. Your account always keeps at least one admin.</p></div>
    <div class="protect">${lockIcon}<span><b>Professionals never see your team list.</b> Only your colleagues and Consumer Talent can see who's on your account.</span></div>
  </div></div>`;
  let role="Hiring manager";
  app.querySelectorAll("[data-ir]").forEach(b=>b.onclick=()=>{role=b.dataset.ir;app.querySelectorAll("[data-ir]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));$("#in_rd").textContent=ROLES[role]});
  app.querySelectorAll("[data-tm]").forEach(b=>b.onclick=async()=>{const [id,a]=b.dataset.tm.split(":");if(a==="remove"&&!confirmInline(b,"Tap again to remove"))return;b.disabled=true;
    const {error}=await sb.rpc("team_member_action",{p_user:id,p_action:a});if(error){b.disabled=false;return toast(error.message.replace(/^.*?:\s*/,""))}
    toast(a==="remove"?"Removed from your team":a==="make_admin"?"They're now an admin":"Admin rights removed");vTeamLive()});
  app.querySelectorAll("[data-tcopy]").forEach(b=>b.onclick=async()=>{const url=location.origin+location.pathname+"?invite="+b.dataset.tcopy;
    try{await navigator.clipboard.writeText(url);toast("Invite link copied. Send it to them by email, Teams or text.")}catch(e){layer.innerHTML=`<div class="scrim" id="tcS"><div class="modal stack" style="max-width:480px;gap:10px"><h2 style="margin:0">Invite link</h2><p class="muted small">Copy this and send it to them.</p><input type="text" value="${esc(url)}" readonly id="tcU"><div class="row" style="justify-content:flex-end"><button class="btn" id="tcX">Done</button></div></div></div>`;$("#tcU").select();$("#tcX").onclick=()=>layer.innerHTML=""}});
  app.querySelectorAll("[data-ti]").forEach(b=>b.onclick=async()=>{const [id,a]=b.dataset.ti.split(":");b.disabled=true;
    const {error}=await sb.rpc("team_invite_action",{p_inv:id,p_action:a});if(error){b.disabled=false;return toast(error.message.replace(/^.*?:\s*/,""))}
    toast(a==="resend"?"Invite sent again":"Invite cancelled");vTeamLive()});
  const f=$("#invF");if(f)f.onsubmit=async e=>{e.preventDefault();const v=i=>$("#"+i).value.trim(),err=m=>{const x=$("#in_err");x.textContent=m;x.style.display="block"};
    if(v("in_n").length<2||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v("in_e")))return err("Add their name and a valid work email.");
    const b=f.querySelector("[type=submit]");b.disabled=true;
    const {error}=await sb.rpc("team_invite",{p_email:v("in_e"),p_name:v("in_n"),p_title:v("in_t"),p_dept:v("in_d"),p_role:role});b.disabled=false;
    if(error)return err(error.message.replace(/^.*?:\s*/,""));toast(`Invite sent to ${v("in_e")}`);vTeamLive()}}
VIEWS.team=()=>vTeamLive();

/* ---------- company chat: real messages, no simulated replies ---------- */
const _vChats=vChats;
vChats=function(){_vChats();
  ["#bIv","#bOffer","[data-ivnew]"].forEach(s=>app.querySelectorAll(s).forEach(x=>x.remove()));
  {const id=S.activeChat,i=S.intros[id],c=POOL.find(p=>p.id===id);const th=app.querySelector(".thead");
   if(i&&c&&th){const canBook=i.stage>=3&&!i.closed&&!ivActive(i.dbId).length&&termsOK();
     const row=th.querySelector(".line1 .row");
     if(row&&!i.closed&&i.stage>=2){const cb=document.createElement("button");cb.className="btn quiet sm";cb.textContent="Close chat";row.appendChild(cb);
       cb.onclick=async()=>{if(!confirmInline(cb,"Tap again: close and return them to the talent pool"))return;cb.disabled=true;
         const {error}=await sb.from("intros").update({closed:{by:"client",at:new Date().toISOString()},status:"closed"}).eq("id",i.dbId);
         if(error){cb.disabled=false;return toast("Couldn't close the chat. Please try again.")}
         logEvent(`Closed the chat with ${refOf(c.user)} and returned them to the talent pool`,S.company.contact||"");
         S.activeChat=null;await refresh();location.hash="pool";toast("Chat closed. They're back in your talent pool.")}}
     if(row&&canBook){const b=document.createElement("button");b.className="btn sm";b.id="bIvLive";b.textContent="Schedule interview";row.prepend(b);b.onclick=()=>ivPropose(i,c,null)}
     const pn=ivClientPanel(i,c);if(pn){const d=document.createElement("div");d.className="stack";d.style.gap="8px";d.innerHTML=pn;th.appendChild(d)}
     app.querySelectorAll(".blkcard .muted.small").forEach(x=>x.textContent=i.stage>=3?"Use Schedule interview at the top and contact details are shared automatically.":"Schedule interview is available once you can see their name.");
     bindIvClient(i,c)}}
  const f=$("#cmp");if(!f)return;const nf=f.cloneNode(true);f.replaceWith(nf);
  nf.addEventListener("submit",async e=>{e.preventDefault();const id=S.activeChat,i=S.intros[id],c=POOL.find(p=>p.id===id);const v=$("#cmpT").value.trim();if(!v||!i)return;
    if(CONTACT_RE.test(v)){i.msgs.push(blockedContact("client",S.company.name||"A client",i.stage>=3?c.name:refOf(c.user)));save();vChats();return}
    i.msgs.push({f:"me",t:v,at:tnow(),_ins:true});vChats();
    const r=await sb.from("messages").insert({intro_id:i.dbId,author:L.user.id,side:"client",audience:"both",body:v});if(r.error)toast("Message didn't send. Please try again.");refreshSoon(150)})};
VIEWS.chats=vChats;

/* ---------- tabs and views per account ---------- */
const keep=(arr,ok)=>{const k=arr.filter(t=>ok.includes(t[0]));arr.length=0;k.forEach(t=>arr.push(t))};
keep(CLIENT_TABS,["company","foryou","applicants","discover","pool","shortlist","chats","team","terms"]);
keep(CAND_TABS,["candidate","companies","allcos","introductions","messages"]);
keep(ADMIN_TABS,["dash","interviews","invites","clients","termsadmin","protect","waitlist"]);
const ai=ADMIN_TABS.find(t=>t[0]==="invites");if(ai){ai[1]="Sign-ups";ai[2]="i"}
const ROLE_TABS={client:CLIENT_TABS,pro:CAND_TABS,admin:ADMIN_TABS};
view=function(){const h=location.hash.slice(1);if(!L.role)return "auth";if(h==="sign"&&L.role==="client")return h;const ok=ROLE_TABS[L.role].map(t=>t[0]);return ok.includes(h)?h:ok[0]};
VIEWS.auth=vAuth;

/* ---------- sign in / join ---------- */
// Public sign-up is closed until launch: people join the launch list on the landing page instead.
// Sign-in, team invites and password resets still work. Set to true on launch day.
const SIGNUPS_OPEN=false;
// arriving from the landing page: open in Join mode, with what they already typed
try{const q=new URLSearchParams(location.search),th=q.get("confirm"),ty=q.get("type");if(th&&["signup","recovery","magiclink","email_change","invite"].includes(ty)){L.confirm={th,ty};history.replaceState(null,"",location.pathname)}}catch(e){}
try{const q=new URLSearchParams(location.search),inv=q.get("invite");if(inv&&/^[0-9a-f-]{36}$/i.test(inv)){L.inviteId=inv;L.joinIntent=true;L.authMode="up";L.authSide="client";history.replaceState(null,"",location.pathname)}}catch(e){}
try{const q=new URLSearchParams(location.search),j=q.get("join");if(j){L.joinIntent=true;L.authMode="up";L.authSide=j==="company"?"client":"pro";history.replaceState(null,"",location.pathname+location.hash)}
  const pf=JSON.parse(localStorage.getItem("ctx_join")||"null");if(pf){L.joinIntent=true;L.prefill=pf;L.authMode="up";L.authSide=pf.side==="client"?"client":"pro"}}catch(e){}
function launchSoon(){$("#tabs").innerHTML="";try{$("#sideLbl").textContent=""}catch(e){}
  app.innerHTML=`<div style="max-width:460px;margin:20px auto" class="card stack"><span class="kicker">Launching soon</span><h1 style="margin:0">The Exchange opens soon</h1>
    <p class="muted">We're getting everything ready. Join the launch list and you'll be among the first in when it opens. Jamie and Connor approve every hiring company personally.</p>
    <a class="btn" href="../#join" style="justify-content:center">Join the launch list</a>
    <button class="btn line" id="lsIn" style="justify-content:center">I already have an account</button></div>`;
  $("#lsIn").onclick=()=>{L.authMode="in";L.joinIntent=false;vAuth()}}
function fillAuth(){const p=L.prefill;if(!p)return;const set=(id,v)=>{const el=$("#"+id);if(el&&v&&!el.value)el.value=v};
  set("auN",p.name);set("auE",p.email);set("auC",p.company);set("auT",p.title);
  const r=$("#auR");if(r&&p.region&&[...r.options].some(o=>o.text===p.region))r.value=p.region;
  const pw=$("#auP");if(pw&&p.email)setTimeout(()=>{try{pw.focus()}catch(e){}},50)}
function vAuth(){if(!SIGNUPS_OPEN&&L.authMode==="up"&&!L.invite)return launchSoon();const mode=L.authMode||"in",side=L.authSide||"pro";
  $("#tabs").innerHTML="";try{$("#sideLbl").textContent=""}catch(e){}
  app.innerHTML=`<div style="max-width:460px;margin:20px auto" class="card stack">
    <div class="stack" style="gap:6px"><span class="kicker">Consumer Talent Exchange</span><h1 style="margin:0">${mode==="in"?"Sign in":L.invite?"Join "+esc(L.invite.company):"Join the Exchange"}</h1>
      <p class="muted">${mode==="up"&&L.invite?`You've been invited to join <b>${esc(L.invite.company)}</b>'s account. Choose a password to get started.`:mode==="in"?"Welcome back.":side==="pro"?"Free for professionals. Your name and employer are never shown without your approval.":"For companies hiring in food and drink. Jamie and Connor approve every company personally."}</p></div>
    ${mode==="up"&&!L.invite?`<div class="seg" role="group" aria-label="I am" style="width:100%"><button type="button" data-sd="pro" aria-pressed="${side==="pro"}" style="flex:1">Professional</button><button type="button" data-sd="client" aria-pressed="${side==="client"}" style="flex:1">Company</button></div>`:""}
    <form class="stack" id="auF" style="gap:10px">
      ${mode==="up"?`<label class="field">Full name<input type="text" id="auN" required autocomplete="name"></label>
        ${side==="client"&&L.invite?`<input type="hidden" id="auC" value="${esc(L.invite.company)}"><label class="field">Your job title<input type="text" id="auT" value="${esc(L.invite.title||"")}"></label>`:side==="client"?`<label class="field">Company<input type="text" id="auC" required autocomplete="organization" placeholder="e.g. Prairie Mill Snacks"></label><label class="field">Your job title<input type="text" id="auT" placeholder="e.g. VP People"></label>`
          :`<label class="field">Your level<select id="auL">${GROUPS.map(([g,ls])=>`<optgroup label="${esc(g)}">${ls.map(l=>`<option value="${l}" ${l==="NAM"?"selected":""}>${esc(LEVELS[l])}</option>`).join("")}</optgroup>`).join("")}</select></label>
            <label class="field">Region<select id="auR">${REGIONS.map(r=>`<option ${r==="Midwest"?"selected":""}>${esc(r)}</option>`).join("")}</select></label>`}`:""}
      <label class="field">Email<input type="email" id="auE" required autocomplete="email"></label>
      <label class="field">Password <small>${mode==="up"?"At least 8 characters":""}</small><input type="password" id="auP" required minlength="${mode==="up"?8:1}" autocomplete="${mode==="up"?"new-password":"current-password"}"></label>
      <p class="small" id="auErr" style="color:var(--bad);display:none"></p>
      ${mode==="up"?`<p class="muted small" style="margin:0">By joining you agree to our <a href="../terms/" target="_blank">terms of use</a> and <a href="../privacy/" target="_blank">privacy policy</a>.</p>`:""}
      <button class="btn" type="submit" style="justify-content:center">${mode==="in"?"Sign in":L.invite?"Join "+esc(L.invite.company):side==="pro"?"Create my free profile":"Create company account"}</button>
    </form>
    ${mode==="in"?`<p class="small" style="text-align:center;margin:-4px 0 0"><a href="#" id="auFg">Forgot your password?</a></p>`:""}
    <p class="muted small" style="text-align:center">${mode==="in"?`New here? <a href="#" id="auSw">${SIGNUPS_OPEN?"Join the Exchange":"Join the launch list"}</a>`:`Already have an account? <a href="#" id="auSw">Sign in</a>`}</p>
  </div>`;
  if(L.linkErr){const x=$("#auErr");x.textContent=L.linkErr;x.style.display="block";L.linkErr=null}
  if(mode==="up"&&L.invite){const n=$("#auN"),e=$("#auE");if(n&&!n.value)n.value=L.invite.name||"";if(e){e.value=L.invite.email;e.readOnly=true;e.title="Your invite is for this email"}}
  if(mode==="up")fillAuth();else if(L.prefill){const el=$("#auE");if(el&&L.prefill.email)el.value=L.prefill.email}
  $("#auSw").onclick=e=>{e.preventDefault();L.authMode=mode==="in"?"up":"in";vAuth()};
  const fg=$("#auFg");if(fg)fg.onclick=async e=>{e.preventDefault();const email=$("#auE").value.trim().toLowerCase(),x=$("#auErr");
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){x.textContent="Type your email above first, then tap Forgot your password.";x.style.display="block";return}
    const r=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
    if(r.error&&/rate limit/i.test(r.error.message)){x.textContent="Too many attempts. Please wait a minute and try again.";x.style.display="block";return}
    authCheck(email,"reset")};
  app.querySelectorAll("[data-sd]").forEach(b=>b.onclick=()=>{L.authSide=b.dataset.sd;vAuth()});
  $("#auF").onsubmit=async e=>{e.preventDefault();const err=m=>{const x=$("#auErr");x.textContent=m;x.style.display="block"};const btn=$("#auF button[type=submit]");btn.disabled=true;
    const email=$("#auE").value.trim().toLowerCase(),password=$("#auP").value;let r;
    if(mode==="in")r=await sb.auth.signInWithPassword({email,password});
    else{const data={role:side,name:$("#auN").value.trim()};if(side==="client"){data.company=$("#auC").value.trim();data.title=$("#auT").value.trim()}else{data.lvl=$("#auL").value;data.region=$("#auR").value}
      r=await sb.auth.signUp({email,password,options:{data,emailRedirectTo:location.origin+location.pathname}})}
    btn.disabled=false;
    if(r.error){if(/not confirmed/i.test(r.error.message))return authCheck(email,"confirm");
      return err(/invalid login/i.test(r.error.message)?"That email and password don't match.":/registered|exists/i.test(r.error.message)?"There's already an account with that email. Sign in instead.":/rate limit/i.test(r.error.message)?"Too many attempts. Please wait a minute and try again.":r.error.message)}
    if(!r.data.session)return authCheck(email,"confirm");
    await start(r.data.session)};
}

function authCheck(email,kind){$("#tabs").innerHTML="";
  app.innerHTML=`<div style="max-width:460px;margin:20px auto" class="card stack"><span class="kicker">Check your email</span>
    <h1 style="margin:0">${kind==="reset"?"Reset link sent":"Confirm your email"}</h1>
    <p class="muted">${kind==="reset"?`If there's an account for <b>${esc(email)}</b>, we've sent a link to choose a new password. It works once and expires in an hour.`:`We've sent a link to <b>${esc(email)}</b>. Tap it to confirm your email and you'll be signed straight in.`}</p>
    <p class="muted small">Nothing there after a couple of minutes? Check your junk folder${kind==="confirm"?`, or <a href="#" id="auRs">send it again</a>`:""}.</p>
    <p class="small" id="auMsg" style="display:none"></p>
    <button class="btn line" id="auBk" style="justify-content:center">Back to sign in</button></div>`;
  $("#auBk").onclick=()=>{L.authMode="in";vAuth()};
  const rs=$("#auRs");if(rs)rs.onclick=async e=>{e.preventDefault();const r=await sb.auth.resend({type:"signup",email,options:{emailRedirectTo:location.origin+location.pathname}});const m=$("#auMsg");m.textContent=r.error?(/rate limit/i.test(r.error.message)?"Please wait a minute before sending another.":r.error.message):"Sent again.";m.style.display="block"}}
function authNewPw(){$("#tabs").innerHTML="";
  app.innerHTML=`<div style="max-width:460px;margin:20px auto" class="card stack"><span class="kicker">Consumer Talent Exchange</span><h1 style="margin:0">Choose a new password</h1>
    <form class="stack" id="npF" style="gap:10px"><label class="field">New password <small>At least 8 characters</small><input type="password" id="npP" required minlength="8" autocomplete="new-password"></label>
    <p class="small" id="npErr" style="color:var(--bad);display:none"></p><button class="btn" type="submit" style="justify-content:center">Save and sign in</button></form></div>`;
  $("#npF").onsubmit=async e=>{e.preventDefault();const r=await sb.auth.updateUser({password:$("#npP").value});
    if(r.error){const x=$("#npErr");x.textContent=r.error.message;x.style.display="block";return}
    L.recovering=false;toast("Password changed");const {data}=await sb.auth.getSession();if(data.session)await start(data.session)}}

/* ---------- push notifications on this device ---------- */
const VAPID="BGmEvdgzu8Ukronq7qH4Q9RNFdmg5e2AKctobk9wQ3atDwJiBUsR_drfZ5qQre-GVcCXfX2YTqYFPzQCN08ICys";
const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const standalone=window.matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
const pushOK=()=>"serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window;
const b64u=s=>{const p="=".repeat((4-s.length%4)%4),r=atob((s+p).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from([...r].map(c=>c.charCodeAt(0)))};
async function pushSub(){try{const reg=await navigator.serviceWorker.ready;return await reg.pushManager.getSubscription()}catch(e){return null}}
async function pushStatus(){if(isIOS&&!standalone)return "ios-install";if(!pushOK())return "unsupported";
  if(Notification.permission==="denied")return "blocked";return Notification.permission==="granted"&&await pushSub()?"on":"off"}
async function savePushSub(sub){const j=sub.toJSON();await sb.from("push_subs").upsert({user_id:L.user.id,endpoint:j.endpoint,sub:j},{onConflict:"endpoint"})}
async function enablePush(){try{if(await Notification.requestPermission()!=="granted")return false;
    const reg=await navigator.serviceWorker.ready;const sub=(await reg.pushManager.getSubscription())||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64u(VAPID)});
    await savePushSub(sub);return true}catch(e){console.warn(e);return false}}
async function disablePush(){const sub=await pushSub();if(!sub)return;try{await sb.from("push_subs").delete().eq("endpoint",sub.endpoint)}catch(e){}try{await sub.unsubscribe()}catch(e){}}
function pushCardHTML(st){return st==="on"?`<div class="row" style="justify-content:space-between;gap:10px"><span class="small muted">Notifications are on for this device.</span><button class="btn quiet sm" id="puOff">Turn off</button></div>`
  :st==="off"?`<div class="row" style="justify-content:space-between;gap:10px"><span class="small"><b>Get notified on this device</b><br><span class="muted">Instant alerts for introductions and messages, as well as email.</span></span><button class="btn sm" id="puOn">Turn on</button></div>`
  :st==="ios-install"?`<p class="small muted" style="margin:0"><b>Want alerts on your iPhone?</b> Tap the Share button in Safari, then <b>Add to Home Screen</b>. Open the Exchange from your home screen and turn notifications on here.</p>`
  :st==="blocked"?`<p class="small muted" style="margin:0">Notifications are blocked for this site. Turn them on in your browser or phone settings to get alerts here.</p>`:""}
function bindPush(root,after){const on=root.querySelector("#puOn"),off=root.querySelector("#puOff");
  if(on)on.onclick=async()=>{on.disabled=true;const ok=await enablePush();toast(ok?"Notifications on for this device":"Notifications weren't turned on");after()};
  if(off)off.onclick=async()=>{await disablePush();toast("Notifications off for this device");after()}}
// one gentle prompt per device after signing in
async function pushPrompt(){let seen=false;try{seen=localStorage.getItem("ctx_push_ask")==="1"}catch(e){}if(seen)return;
  const st=await pushStatus();if(st!=="off"&&st!=="ios-install")return;
  const d=document.createElement("div");d.id="puBar";d.className="card";d.style.cssText="position:fixed;left:16px;right:16px;bottom:16px;max-width:520px;margin:0 auto;z-index:50;box-shadow:0 10px 30px rgba(0,0,0,.35)";
  const close=()=>{try{localStorage.setItem("ctx_push_ask","1")}catch(e){}d.remove()};
  d.innerHTML=st==="off"?`<p class="small" style="margin:0"><b>Get notified on this device</b><br><span class="muted">Instant alerts when a company wants to chat or you get a message, as well as email.</span></p>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn quiet sm" id="puNo">Not now</button><button class="btn sm" id="puOn">Turn on</button></div>`
    :pushCardHTML(st)+`<div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn quiet sm" id="puNo">Got it</button></div>`;
  document.body.appendChild(d);d.querySelector("#puNo").onclick=close;bindPush(d,close)}

function authSwitch(session){$("#tabs").innerHTML="";try{$("#sideLbl").textContent=""}catch(e){}const who=session.user.email;
  app.innerHTML=`<div style="max-width:460px;margin:20px auto" class="card stack"><span class="kicker">Join the Exchange</span>
    <h1 style="margin:0">You're already signed in</h1>
    <p class="muted">This browser is signed in as <b>${esc(who)}</b>. To create a new account${L.prefill&&L.prefill.email?` for <b>${esc(L.prefill.email)}</b>`:""}, sign out first.</p>
    <button class="btn" id="swOut" style="justify-content:center">Sign out and create the new account</button>
    <button class="btn line" id="swStay" style="justify-content:center">Continue as ${esc(who)}</button></div>`;
  $("#swOut").onclick=async()=>{L.authMode="up";L.authSide=L.prefill&&L.prefill.side==="client"?"client":(L.authSide||"pro");await disablePush();await sb.auth.signOut({scope:"local"});L.role=null;vAuth()};
  $("#swStay").onclick=async()=>{L.joinIntent=false;await start(session)}}

/* ---------- account settings: email, password, sign out everywhere ---------- */
function openAccount(){const em=L.user.email;
  layer.innerHTML=`<div class="scrim" id="acS"><div class="modal stack" role="dialog" aria-modal="true" aria-labelledby="acT" style="max-width:480px;gap:16px">
    <div class="stack" style="gap:4px"><span class="kicker">Your account</span><h2 id="acT">Account settings</h2><p class="muted small">Signed in as <b>${esc(em)}</b></p></div>
    <form class="stack" id="acE" style="gap:8px;border-top:1px solid var(--line);padding-top:14px"><b>Change email</b>
      <label class="field">New email<input type="email" id="acEm" required autocomplete="email"></label>
      <p class="muted small" style="margin:0">We'll email a confirmation link to both your current and your new address. The change happens once you've confirmed.</p>
      <p class="small" id="acEr" style="display:none"></p><div class="row" style="justify-content:flex-end"><button class="btn sm" type="submit">Send confirmation</button></div></form>
    <form class="stack" id="acP" style="gap:8px;border-top:1px solid var(--line);padding-top:14px"><b>Change password</b>
      <label class="field">Current password<input type="password" id="acP0" required autocomplete="current-password"></label>
      <label class="field">New password <small>At least 8 characters</small><input type="password" id="acP1" required minlength="8" autocomplete="new-password"></label>
      <p class="small" id="acPr" style="display:none"></p><div class="row" style="justify-content:flex-end"><button class="btn sm" type="submit">Change password</button></div></form>
    <div class="stack" style="gap:8px;border-top:1px solid var(--line);padding-top:14px"><b>Sign out everywhere</b>
      <p class="muted small" style="margin:0">Signs you out on every phone and computer, for example if you've lost a device or used a shared computer.</p>
      <div class="row" style="justify-content:flex-end"><button class="btn line sm" id="acAll">Sign out everywhere</button></div></div>
    <p class="muted small" style="margin:0;border-top:1px solid var(--line);padding-top:14px">Want your account deleted? <a href="#" id="acDel">Ask Consumer Talent</a> and we'll take care of it. See our <a href="../privacy/" target="_blank">privacy policy</a>.</p>
  </div></div>`;
  $("#acS").onclick=e=>{if(e.target.id==="acS")layer.innerHTML=""};
  const msg=(id,t,ok)=>{const x=$(id);x.textContent=t;x.style.color=ok?"var(--good, #6fcf97)":"var(--bad)";x.style.display="block"};
  $("#acE").onsubmit=async e=>{e.preventDefault();const n=$("#acEm").value.trim().toLowerCase();if(n===em)return msg("#acEr","That's already your email.");
    const r=await sb.auth.updateUser({email:n},{emailRedirectTo:location.origin+location.pathname});
    if(r.error)return msg("#acEr",/rate limit/i.test(r.error.message)?"Please wait a minute and try again.":/already|registered/i.test(r.error.message)?"There's already an account with that email.":r.error.message);
    msg("#acEr",`Check ${em} and ${n} for confirmation links. Your email changes once you've confirmed.`,true)};
  $("#acP").onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector("button");b.disabled=true;
    const chk=await sb.auth.signInWithPassword({email:em,password:$("#acP0").value});
    if(chk.error){b.disabled=false;return msg("#acPr","Your current password isn't right.")}
    const r=await sb.auth.updateUser({password:$("#acP1").value});b.disabled=false;
    if(r.error)return msg("#acPr",/different|same/i.test(r.error.message)?"Choose a password different from your current one.":r.error.message);
    $("#acP0").value="";$("#acP1").value="";msg("#acPr","Password changed.",true)};
  $("#acAll").onclick=async()=>{await disablePush();await sb.auth.signOut({scope:"global"});location.hash="";location.reload()};
  $("#acDel").onclick=e=>{e.preventDefault();contactUs("Delete my account","Please delete my Consumer Talent Exchange account.")}}

/* ---------- contact Consumer Talent from inside the Exchange ---------- */
contactUs=function(topic="Question",preset=""){const back=layer.innerHTML;
  const nm=(S.cand&&S.cand.name)||(L.company&&L.company.private&&L.company.private.contact)||((L.rows&&L.rows.me)||{}).name||"";
  const coName=L.role==="client"&&L.company?L.company.name:"";
  layer.innerHTML=`<div class="scrim" id="cuS"><form class="modal" id="cuF" role="dialog" aria-modal="true" aria-labelledby="cuT" style="max-width:480px">
    <div class="stack" style="gap:4px"><span class="kicker">Consumer Talent</span><h2 id="cuT">Contact Jamie and Connor</h2>
    <p class="muted small">Your message goes straight to Jamie and Connor. They'll reply to <b>${esc(L.user.email)}</b>.</p></div>
    <label class="field">Your name<input type="text" id="cuN" value="${esc(nm)}" autocomplete="name"></label>
    <label class="field">How can we help?<textarea id="cuM" style="min-height:110px" required maxlength="5000">${esc(preset)}</textarea></label>
    <p class="small" id="cuEr" style="color:var(--bad);display:none"></p>
    <div class="row" style="justify-content:flex-end"><button type="button" class="btn line" id="cuX">Cancel</button><button class="btn" type="submit">Send</button></div></form></div>`;
  $("#cuX").onclick=()=>{layer.innerHTML=back;if(back.includes('id="termsBox"')&&typeof openTermsGate==="function")openTermsGate()};
  $("#cuF").onsubmit=async e=>{e.preventDefault();const m=$("#cuM").value.trim();if(!m)return;const b=e.target.querySelector("button[type=submit]");b.disabled=true;
    const {error}=await sb.from("support_msgs").insert({name:$("#cuN").value.trim(),email:L.user.email,company:coName,topic,body:m});
    if(error){b.disabled=false;const x=$("#cuEr");x.textContent="That didn't send. Please try again, or email jamie@consumer-talent.com.";x.style.display="block";return}
    layer.innerHTML="";toast("Sent. Jamie or Connor will reply by email.")}};

function authConfirm(){const c=L.confirm,ty=c.ty;$("#tabs").innerHTML="";
  const T={signup:["Confirm your email","Tap below to confirm your email and finish setting up your account.","Confirm my email"],
    recovery:["Reset your password","Tap below to choose a new password.","Choose a new password"],
    magiclink:["Sign in","Tap below to sign in to the Exchange.","Sign in"],
    email_change:["Confirm your new email","Tap below to confirm the change to your email address.","Confirm new email"],
    invite:["Accept your invite","Tap below to continue.","Continue"]}[ty];
  app.innerHTML=`<div style="max-width:460px;margin:20px auto" class="card stack"><span class="kicker">Consumer Talent Exchange</span><h1 style="margin:0">${T[0]}</h1><p class="muted">${T[1]}</p>
    <p class="small" id="cfErr" style="color:var(--bad);display:none"></p><button class="btn" id="cfGo" style="justify-content:center">${T[2]}</button></div>`;
  $("#cfGo").onclick=async()=>{const b=$("#cfGo");b.disabled=true;b.textContent="One moment...";
    const {data,error}=await sb.auth.verifyOtp({token_hash:c.th,type:ty});L.confirm=null;
    if(error){L.authMode="in";L.linkErr=/expired|invalid|not found/i.test(error.message)?"That link has expired or was already used. Sign in, or tap Forgot your password to get a new one.":error.message;return vAuth()}
    if(ty==="recovery"){L.recovering=true;return authNewPw()}
    if(ty==="email_change"){toast("Email confirmed. If you're asked to confirm on your other address too, do that as well.")}
    const s2=data.session||(await sb.auth.getSession()).data.session;if(s2)await start(s2);else{L.authMode="in";vAuth()}}}

/* ---------- boot ---------- */
async function start(session){L.user=session.user;L.token=session.access_token;
  try{const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;if(tz&&(session.user.user_metadata||{}).tz!==tz){sb.from("profiles").update({tz}).eq("user_id",session.user.id).then(()=>{})}}catch(e){}
  if(pushOK()&&Notification.permission==="granted")pushSub().then(s=>s&&savePushSub(s)).catch(()=>{});setTimeout(pushPrompt,2500);try{localStorage.removeItem("ctx_join")}catch(e){}L.prefill=null;L.invite=null;L.inviteId=null;
  const prof=(await q(sb.from("profiles").select("*").eq("user_id",L.user.id)))[0];
  L.role=TEAM.includes(L.user.email)?"admin":prof?prof.role:"pro";
  if(L.role==="client"){const m=await q(sb.from("company_members").select("company_id").eq("user_id",L.user.id));L.companyId=m[0]&&m[0].company_id}
  S.mode=sideOf();
  await hydrate();subscribe();
  $("#lvOut").hidden=false;$("#lvAcc").hidden=false;$("#lvHelp").hidden=L.role==="admin";$("#lvWho").textContent=L.user.email;
  if(L.role==="admin"){sbSet({email:L.user.email,access_token:session.access_token,refresh_token:session.refresh_token,exp:(session.expires_at||0)*1000});try{await loadWL()}catch(e){}}
  location.hash=location.hash&&location.hash!=="#auth"?location.hash:"#"+ROLE_TABS[L.role][0][0];render();
}
let refT=null;
function refreshSoon(ms){clearTimeout(refT);refT=setTimeout(refresh,ms||400)}
async function refresh(){if(!L.user||L.busy||L.pending){refreshSoon(500);return}
  try{await hydrate()}catch(e){return}
  if(layer.innerHTML&&!/^\s*$/.test(layer.innerHTML)){counts();return}
  const a=document.activeElement,id=a&&a.id,val=a&&("value" in a)?a.value:null,pos=a&&a.selectionStart;
  if(a&&a.matches&&a.matches("#app input:not(#cmpT),#app textarea,#app select")&&view()!=="chats"&&view()!=="messages"){counts();return}
  const y=SC.scrollTop;render();SC.scrollTop=y;
  if(id){const n=document.getElementById(id);if(n){n.focus();if(val!==null&&"value" in n){n.value=val;try{n.setSelectionRange(pos,pos)}catch(e){}}}}}
window.CTX_refresh=refresh;
let chan=null;
function subscribe(){if(chan)sb.removeChannel(chan);chan=sb.channel("ctx-live");
  ["messages","intros","notifications","applies","companies","picks","interviews","terms_deals"].forEach(t=>chan.on("postgres_changes",{event:"*",schema:"public",table:t},()=>refreshSoon(350)));
  chan.subscribe()}

// header: who's signed in, sign out; hide the demo-only switch
const hdr=document.querySelector("header .seg");if(hdr)hdr.style.display="none";
$("#demoTxt").innerHTML=`<span id="lvWho"></span> <button type="button" class="btn quiet sm" id="lvAcc" hidden style="margin-left:8px">Account</button><button type="button" class="btn quiet sm" id="lvHelp" hidden>Contact us</button><button type="button" class="btn quiet sm" id="lvOut" hidden>Sign out</button>`;
$("#lvAcc").onclick=()=>openAccount();$("#lvHelp").onclick=()=>contactUs("Question");
$("#lvOut").onclick=async()=>{await disablePush();try{localStorage.removeItem("ctx_push_ask")}catch(e){}await sb.auth.signOut();location.hash="";location.reload()};
const pt=$("#partners");if(pt)pt.hidden=true;
const _openBell=openBell;
openBell=async function(){_openBell();const st=await pushStatus();const h=$("#nT");if(!h||!pushCardHTML(st))return;
  const box=document.createElement("div");box.id="puBox";box.style.cssText="border:1px solid var(--line);border-radius:12px;padding:10px 12px";box.innerHTML=pushCardHTML(st);
  h.parentElement.after(box);bindPush(box,()=>{const m=$("#nS");if(m)openBell()})};
$("#bell").onclick=()=>openBell();
window.addEventListener("hashchange",()=>{if(!L.role){if(L.recovering)return;if(view()==="auth"&&!$("#auBk"))vAuth();return}render()});
const _render=render;
render=function(){if(!L.role){vAuth();return}
  if(L.role==="client"&&L.editAnyway&&L.company&&L.company.status==="pending"){const v=view();if(v==="company"){$("#tabs").innerHTML=`<a href="#company" class="on">Company profile</a>`;S.mode="client";vCompany();counts();return}}
  _render()};
L.recovering=/type=recovery/.test(location.hash);
try{const h=new URLSearchParams(location.hash.slice(1));if(h.get("error_description"))L.linkErr=/expired|invalid/i.test(h.get("error_description"))?"That link has expired or was already used. Sign in, or tap Forgot your password to get a new one.":h.get("error_description")}catch(e){}
sb.auth.onAuthStateChange((ev,session)=>{if(session)L.token=session.access_token;if(ev==="PASSWORD_RECOVERY"){L.recovering=true;setTimeout(authNewPw,0)}if(ev==="SIGNED_OUT"){L.role=null;vAuth()}});
(async()=>{if(L.inviteId){try{const {data:inf}=await sb.rpc("invite_info",{p_inv:L.inviteId});if(inf&&inf.company)L.invite=inf;else{L.authMode="in";L.linkErr="This invite has already been used or was cancelled. If you've already joined, sign in. Otherwise ask your colleague to send a new one."}}catch(e){}}
  const {data}=await sb.auth.getSession();if(location.hash.includes("access_token")||location.hash.includes("error="))history.replaceState(null,"",location.pathname);
  if(L.confirm)return authConfirm();
  if(L.recovering&&data.session)return authNewPw();
  if(data.session&&L.joinIntent)return authSwitch(data.session);
  if(data.session)await start(data.session);else vAuth()})();
})();
