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
  const pv=Object.fromEntries(privs.map(p=>[p.user_id,p]));
  setArr(POOL,pubs.filter(p=>p.user_id!==uid).map(p=>toPool(p,pv[p.user_id])));setArr(DATA,POOL);for(const k in REFID)delete REFID[k];POOL.forEach(p=>REFID[p.user]=p.id);
  const ids=intros.map(i=>i.id);const msgs=ids.length?await q(sb.from("messages").select("*").in("intro_id",ids).order("id")):[];
  S.intros={};L.rows.intros={};
  intros.forEach(i=>{const c=POOL.find(p=>p.id===i.pro_id);const cs=i.client_state||{};
    let stage=i.status==="accepted"||i.status==="closed"&&i.accepted_at?2:1;if(stage===2&&c&&c._named)stage=3;if(cs.cstage&&cs.cstage>stage)stage=cs.cstage;
    const review=i.status==="blocked"?"declined":i.status==="declined"?"passed":"approved";
    const ii=Object.assign({},cs,{dbId:i.id,ref:i.ref,stage,review,at:ago(i.created_at),role:i.role,base:i.base,note:i.note,by:"",prior:i.prior||undefined,priorRecent:!!(i.prior&&i.prior.prior==="Yes"),
      acceptedAt:i.accepted_at?ago(i.accepted_at):undefined,closed:i.closed?{by:i.closed.by==="pro"?"pro":"client",at:i.closed.at}:undefined,fromApply:i.from_apply,
      msgs:msgs.filter(m=>m.intro_id===i.id&&(m.audience==="both"||m.audience==="client")).map(m=>Object.assign({},m.payload&&m.payload.f?m.payload:{},{dbId:m.id,f:m.side==="client"?"me":m.side==="pro"?"them":(m.payload&&m.payload.f)||m.side,t:m.body,at:tfmt(m.created_at)}))});
    S.intros[i.pro_id]=ii;L.rows.intros[i.pro_id]={cs:J(cleanCS(ii)),closed:!!i.closed}});
  S.decided={};S.shortlist=[];picks.forEach(p=>{S.decided[p.pro_id]=p.decision;if(p.decision==="keep")S.shortlist.push(p.pro_id)});L.snap.picks=J(S.decided);
  S.applies=applies.filter(a=>a.status!=="withdrawn").map(a=>({id:a.id,cid:a.pro_id,role:a.role,note:a.note,at:ago(a.created_at),status:a.status}));L.snap.applies=Object.fromEntries(S.applies.map(a=>[a.id,a.status]));
  S.log=events.map(e=>({at:new Date(e.at),what:e.what,who:e.who}));
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
  S.creqs=[];S.cthreads={};
  intros.sort((a,b)=>ago(b.created_at)-ago(a.created_at)).forEach(i=>{const co=list.find(c=>c.id===i.company_id)||{name:"A company",anon:true,cats:[],stage:"CHAL"};
    S.creqs.push({id:i.id,coId:i.company_id,at:ago(i.created_at),co:co.name||"",role:i.role,base:i.base,stage:co.stage,hq:co.hq,why:co.why||co.tagline||"",status:i.status==="sent"?"new":i.status==="declined"?"no":"yes",prior:i.prior||undefined,closed:i.closed?(i.closed.by==="pro"?"pro":"client"):undefined,ref:i.ref,fromApply:i.from_apply});
    if(i.accepted_at)S.cthreads[i.id]=msgs.filter(m=>m.intro_id===i.id&&(m.audience==="both"||m.audience==="pro")).map(m=>Object.assign({},m.payload&&m.payload.f?m.payload:{},{dbId:m.id,f:m.side==="pro"?"me":m.side==="client"?"them":(m.payload&&m.payload.f)||m.side,t:m.body,at:tfmt(m.created_at)}))});
}
async function hydrateAdmin(){
  const [cos,mem,profs,pubs,privs,intros,events]=await Promise.all([q(sb.from("companies").select("*").order("created_at",{ascending:false})),q(sb.from("company_members").select("*")),q(sb.from("profiles").select("*")),
    q(sb.from("pro_public").select("*")),q(sb.from("pro_private").select("*")),q(sb.from("intros").select("*")),q(sb.from("events").select("*").order("at").limit(5000))]);
  L.rows={cos,mem,profs,intros,events};
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
          if(i.closed&&!row.closed&&i.closed.by!=="pro")upd.closed={by:"client",at:new Date().toISOString()};
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
const _vLocked=vLocked;
vLocked=function(){const st=L.company&&L.company.status;
  if(st==="pending")return void(app.innerHTML=`<div class="empty" style="max-width:560px;margin:30px auto;text-align:left"><span class="kicker">Almost there</span><h1>Thanks for joining, ${esc((S.company.contact||"").split(" ")[0]||"there")}</h1><p class="muted">Jamie and Connor approve every company personally, usually within a working day. You'll get a notification as soon as ${esc(S.company.name)} is approved. In the meantime you can set up your company profile.</p><div class="row" style="margin-top:12px"><a class="btn" href="#company" id="lkCo">Set up your company profile</a>${contactBtn()}</div></div>`,bindContact(app,"Approval"),$("#lkCo").onclick=e=>{e.preventDefault();L.editAnyway=true;location.hash="company";render()});
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
  ${D.length?`<div class="card stack"><h2>Declined</h2><div class="list">${D.map(c=>card(c,true)).join("")}</div></div>`:""}</div>`;
  app.querySelectorAll("[data-ok]").forEach(b=>b.onclick=async()=>{b.disabled=true;await setAccess(b.dataset.ok,"active",{histWhat:"Approved"},"Consumer Talent");toast("Approved. They can use the Exchange now.")});
  app.querySelectorAll("[data-no]").forEach(b=>b.onclick=async()=>{b.disabled=true;const co=R.cos.find(c=>c.id===b.dataset.no);await q(sb.from("companies").update({status:"declined"}).eq("id",co.id));co.status="declined";refreshSoon(50);toast("Declined")})};
VIEWS.invites=vInvites;
allDeals=function(){const R=L.rows;if(!R.intros)return [];const lastBy={};(R.events||[]).forEach(e=>{if(e.intro_id)lastBy[e.intro_id]=ago(e.at)});
  return R.intros.map(i=>{const c=POOL.find(p=>p.id===i.pro_id);if(!c)return null;const co=R.cos.find(x=>x.id===i.company_id)||{name:"?"};const cs=i.client_state||{};
    let s=i.accepted_at?(co.terms?3:2):1;if(cs.cstage&&cs.cstage>s)s=cs.cstage;const st=[0,0,1,2,3,5][s];
    let drop=null;if(i.status==="declined")drop={by:"Candidate",why:"Declined the introduction",ago:Math.floor((Date.now()-ago(i.declined_at||i.created_at))/864e5)};
    else if(i.status==="blocked")drop={by:"Consumer Talent",why:"Blocked automatically (their employer)",ago:Math.floor((Date.now()-ago(i.created_at))/864e5)};
    else if(i.closed)drop={by:i.closed.by==="pro"?"Candidate":"Client",why:(i.prior&&i.prior.prior==="Yes"&&cs.priorDecision==="end")?"Interviewed them in the last 6 months":i.closed.by==="pro"?"Decided not to take it forward":"Decided to go separate ways",ago:Math.floor((Date.now()-ago(i.closed.at||i.created_at))/864e5)};
    const v=cs.offer&&cs.offer.summary?+((cs.offer.summary.match(/Package \$([\d,]+)/)||[0,"0"])[1].replace(/,/g,"")):pkg(c);const R2=rateFor(co.name,null,v);const fee=Math.round(v*R2.pct/100);
    const last=Math.floor((Date.now()-(lastBy[i.id]||ago(i.created_at)))/864e5);const alerts=[];if(!drop&&st===2&&last>=7)alerts.push(["warn",`Quiet ${last} days after reveal`]);if(!drop&&st===4)alerts.push(["new","Chase offer decision"]);if(st===5)alerts.push(["hit","Invoice due"]);
    return {id:i.id,co:co.name,c,st,start:Math.floor((Date.now()-ago(i.created_at))/864e5),last,ivAgo:null,live:false,drop,v,pct:R2.pct,custom:R2.custom,fee,wfee:fee,alerts}}).filter(Boolean)};
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
      r.status==="yes"?`<div class="row"><a class="btn sm" href="#messages" data-go="${r.id}">Open conversation</a></div>`:""}
  </div>`}).join(""):`<div class="empty"><h2>No requests yet</h2><p class="muted">When a company asks to meet you, it appears here and you get a notification. The more complete your profile, the more you'll be found.</p><a class="btn" href="#candidate">Improve my profile</a></div>`}</div>`;
  app.querySelectorAll("[data-yes]").forEach(b=>b.onclick=()=>priorCheck(b.dataset.yes,async rid=>{const r=S.creqs.find(x=>x.id===rid);
    const up=await sb.from("intros").update({accepted_at:new Date().toISOString(),status:"accepted",prior:r.prior||{prior:"No"}}).eq("id",rid);
    if(up.error){toast("Couldn't accept just now. Please try again.");return}
    await sb.from("messages").insert({intro_id:rid,author:L.user.id,side:"ct",audience:"pro",body:`You accepted ${coDisplay(reqCo(r))}'s request to chat. Your name is only shared with them once their terms are signed. Everything here is logged on the introduction record. Jamie, Consumer Talent`});
    S.cthread=rid;await refresh();location.hash="messages";toast("Accepted. Your conversation is open.")}));
  app.querySelectorAll("[data-no]").forEach(b=>b.onclick=async()=>{await sb.from("intros").update({declined_at:new Date().toISOString(),status:"declined"}).eq("id",b.dataset.no);await refresh();toast("Declined. They'll be told you didn't want to move forward at this time.")});
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

/* ---------- company chat: real messages, no simulated replies ---------- */
const _vChats=vChats;
vChats=function(){_vChats();
  ["#bIv","#bOffer","[data-ivnew]"].forEach(s=>app.querySelectorAll(s).forEach(x=>x.remove()));
  const f=$("#cmp");if(!f)return;const nf=f.cloneNode(true);f.replaceWith(nf);
  nf.addEventListener("submit",async e=>{e.preventDefault();const id=S.activeChat,i=S.intros[id],c=POOL.find(p=>p.id===id);const v=$("#cmpT").value.trim();if(!v||!i)return;
    if(CONTACT_RE.test(v)){i.msgs.push(blockedContact("client",S.company.name||"A client",i.stage>=3?c.name:refOf(c.user)));save();vChats();return}
    i.msgs.push({f:"me",t:v,at:tnow(),_ins:true});vChats();
    const r=await sb.from("messages").insert({intro_id:i.dbId,author:L.user.id,side:"client",audience:"both",body:v});if(r.error)toast("Message didn't send. Please try again.");refreshSoon(150)})};
VIEWS.chats=vChats;

/* ---------- tabs and views per account ---------- */
const keep=(arr,ok)=>{const k=arr.filter(t=>ok.includes(t[0]));arr.length=0;k.forEach(t=>arr.push(t))};
keep(CLIENT_TABS,["company","foryou","applicants","discover","pool","shortlist","chats","terms"]);
keep(CAND_TABS,["candidate","companies","allcos","introductions","messages"]);
keep(ADMIN_TABS,["dash","invites","clients","protect","waitlist"]);
const ai=ADMIN_TABS.find(t=>t[0]==="invites");if(ai){ai[1]="Sign-ups";ai[2]="i"}
const ROLE_TABS={client:CLIENT_TABS,pro:CAND_TABS,admin:ADMIN_TABS};
view=function(){const h=location.hash.slice(1);if(!L.role)return "auth";if(h==="sign"&&L.role==="client")return h;const ok=ROLE_TABS[L.role].map(t=>t[0]);return ok.includes(h)?h:ok[0]};
VIEWS.auth=vAuth;

/* ---------- sign in / join ---------- */
// arriving from the landing page: open in Join mode, with what they already typed
try{const q=new URLSearchParams(location.search),j=q.get("join");if(j){L.authMode="up";L.authSide=j==="company"?"client":"pro";history.replaceState(null,"",location.pathname+location.hash)}
  const pf=JSON.parse(localStorage.getItem("ctx_join")||"null");if(pf){L.prefill=pf;L.authMode="up";L.authSide=pf.side==="client"?"client":"pro"}}catch(e){}
function fillAuth(){const p=L.prefill;if(!p)return;const set=(id,v)=>{const el=$("#"+id);if(el&&v&&!el.value)el.value=v};
  set("auN",p.name);set("auE",p.email);set("auC",p.company);set("auT",p.title);
  const r=$("#auR");if(r&&p.region&&[...r.options].some(o=>o.text===p.region))r.value=p.region;
  const pw=$("#auP");if(pw&&p.email)setTimeout(()=>{try{pw.focus()}catch(e){}},50)}
function vAuth(){const mode=L.authMode||"in",side=L.authSide||"pro";
  $("#tabs").innerHTML="";try{$("#sideLbl").textContent=""}catch(e){}
  app.innerHTML=`<div style="max-width:460px;margin:20px auto" class="card stack">
    <div class="stack" style="gap:6px"><span class="kicker">Consumer Talent Exchange</span><h1 style="margin:0">${mode==="in"?"Sign in":"Join the Exchange"}</h1>
      <p class="muted">${mode==="in"?"Welcome back.":side==="pro"?"Free for professionals. Your name and employer are never shown without your approval.":"For companies hiring in food and drink. Jamie and Connor approve every company personally."}</p></div>
    ${mode==="up"?`<div class="seg" role="group" aria-label="I am" style="width:100%"><button type="button" data-sd="pro" aria-pressed="${side==="pro"}" style="flex:1">Professional</button><button type="button" data-sd="client" aria-pressed="${side==="client"}" style="flex:1">Company</button></div>`:""}
    <form class="stack" id="auF" style="gap:10px">
      ${mode==="up"?`<label class="field">Full name<input type="text" id="auN" required autocomplete="name"></label>
        ${side==="client"?`<label class="field">Company<input type="text" id="auC" required autocomplete="organization" placeholder="e.g. Prairie Mill Snacks"></label><label class="field">Your job title<input type="text" id="auT" placeholder="e.g. VP People"></label>`
          :`<label class="field">Your level<select id="auL">${GROUPS.map(([g,ls])=>`<optgroup label="${esc(g)}">${ls.map(l=>`<option value="${l}" ${l==="NAM"?"selected":""}>${esc(LEVELS[l])}</option>`).join("")}</optgroup>`).join("")}</select></label>
            <label class="field">Region<select id="auR">${REGIONS.map(r=>`<option ${r==="Midwest"?"selected":""}>${esc(r)}</option>`).join("")}</select></label>`}`:""}
      <label class="field">Email<input type="email" id="auE" required autocomplete="email"></label>
      <label class="field">Password <small>${mode==="up"?"At least 8 characters":""}</small><input type="password" id="auP" required minlength="${mode==="up"?8:1}" autocomplete="${mode==="up"?"new-password":"current-password"}"></label>
      <p class="small" id="auErr" style="color:var(--bad);display:none"></p>
      <button class="btn" type="submit" style="justify-content:center">${mode==="in"?"Sign in":side==="pro"?"Create my free profile":"Create company account"}</button>
    </form>
    <p class="muted small" style="text-align:center">${mode==="in"?`New here? <a href="#" id="auSw">Join the Exchange</a>`:`Already have an account? <a href="#" id="auSw">Sign in</a>`}</p>
  </div>`;
  if(mode==="up")fillAuth();else if(L.prefill){const el=$("#auE");if(el&&L.prefill.email)el.value=L.prefill.email}
  $("#auSw").onclick=e=>{e.preventDefault();L.authMode=mode==="in"?"up":"in";vAuth()};
  app.querySelectorAll("[data-sd]").forEach(b=>b.onclick=()=>{L.authSide=b.dataset.sd;vAuth()});
  $("#auF").onsubmit=async e=>{e.preventDefault();const err=m=>{const x=$("#auErr");x.textContent=m;x.style.display="block"};const btn=$("#auF button[type=submit]");btn.disabled=true;
    const email=$("#auE").value.trim().toLowerCase(),password=$("#auP").value;let r;
    if(mode==="in")r=await sb.auth.signInWithPassword({email,password});
    else{const data={role:side,name:$("#auN").value.trim()};if(side==="client"){data.company=$("#auC").value.trim();data.title=$("#auT").value.trim()}else{data.lvl=$("#auL").value;data.region=$("#auR").value}
      r=await sb.auth.signUp({email,password,options:{data}})}
    btn.disabled=false;
    if(r.error)return err(/invalid login/i.test(r.error.message)?"That email and password don't match.":/registered|exists/i.test(r.error.message)?"There's already an account with that email. Sign in instead.":r.error.message);
    if(!r.data.session)return err("Check your email to confirm your account, then sign in.");
    await start(r.data.session)};
}

/* ---------- boot ---------- */
async function start(session){L.user=session.user;L.token=session.access_token;try{localStorage.removeItem("ctx_join")}catch(e){}L.prefill=null;
  const prof=(await q(sb.from("profiles").select("*").eq("user_id",L.user.id)))[0];
  L.role=TEAM.includes(L.user.email)?"admin":prof?prof.role:"pro";
  if(L.role==="client"){const m=await q(sb.from("company_members").select("company_id").eq("user_id",L.user.id));L.companyId=m[0]&&m[0].company_id}
  S.mode=sideOf();
  await hydrate();subscribe();
  $("#lvOut").hidden=false;$("#lvWho").textContent=L.user.email;
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
  ["messages","intros","notifications","applies","companies","picks"].forEach(t=>chan.on("postgres_changes",{event:"*",schema:"public",table:t},()=>refreshSoon(350)));
  chan.subscribe()}

// header: who's signed in, sign out; hide the demo-only switch
const hdr=document.querySelector("header .seg");if(hdr)hdr.style.display="none";
$("#demoTxt").innerHTML=`<span id="lvWho"></span> <button type="button" class="btn quiet sm" id="lvOut" hidden style="margin-left:8px">Sign out</button>`;
$("#lvOut").onclick=async()=>{await sb.auth.signOut();location.hash="";location.reload()};
const pt=$("#partners");if(pt)pt.hidden=true;
$("#bell").onclick=openBell;
window.addEventListener("hashchange",()=>{if(!L.role){if(view()==="auth")vAuth();return}render()});
const _render=render;
render=function(){if(!L.role){vAuth();return}
  if(L.role==="client"&&L.editAnyway&&L.company&&L.company.status==="pending"){const v=view();if(v==="company"){$("#tabs").innerHTML=`<a href="#company" class="on">Company profile</a>`;S.mode="client";vCompany();counts();return}}
  _render()};
(async()=>{const {data}=await sb.auth.getSession();if(data.session)await start(data.session);else vAuth()})();
sb.auth.onAuthStateChange((ev,session)=>{if(session)L.token=session.access_token;if(ev==="SIGNED_OUT"){L.role=null;vAuth()}});
})();
