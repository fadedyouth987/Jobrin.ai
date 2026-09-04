// Cache only immutable build assets. Never cache documents or URLs containing
// auth, recovery, checkout or other one-time tokens.
const CACHE='jobryn-static-v2';
const ASSET_DESTINATIONS=new Set(['style','script','image','font','manifest']);
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.search||!ASSET_DESTINATIONS.has(event.request.destination))return;
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{
    if(response.ok&&response.type==='basic')caches.open(CACHE).then(cache=>cache.put(event.request,response.clone()));
    return response;
  })));
});
