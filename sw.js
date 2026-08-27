const CACHE='amfcc-department-operations-v7-simple-planning';
const CORE=[
  './','./index.html','./manifest.webmanifest',
  './assets_icon.svg','./shared_ui.css','./shared_config.js','./operations.css','./operations.js',
  './meal-checkin.html','./meal-checkin.css','./meal-checkin.js'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>Promise.all(CORE.map(url=>cache.add(new Request(url,{cache:'reload'})).catch(()=>null)))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{
    if(response&&response.ok&&response.type!=='opaque'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
    return response;
  }).catch(()=>caches.match(event.request)));
});
