// Network-first so updates show straight away; falls back to cache offline. Also shows push notifications.
const C="ctx-v30";
self.addEventListener("install",e=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET"||new URL(e.request.url).origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)));});
self.addEventListener("push",e=>{let d={};try{d=e.data?e.data.json():{}}catch(x){d={body:e.data&&e.data.text()}}
  e.waitUntil(self.registration.showNotification(d.title||"Consumer Talent Exchange",{body:d.body||"",tag:d.tag||"ctx",renotify:true,
    icon:new URL("icon-192.png",self.registration.scope).href,badge:new URL("icon-192.png",self.registration.scope).href,
    data:{url:d.url||new URL("exchange/",self.registration.scope).href}}))});
self.addEventListener("notificationclick",e=>{e.notification.close();const url=e.notification.data&&e.notification.data.url;
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(ws=>{
    const w=ws.find(c=>c.url.includes("/exchange/"));if(w){w.navigate?w.navigate(url).catch(()=>{}):0;return w.focus()}
    return self.clients.openWindow(url)}))});
