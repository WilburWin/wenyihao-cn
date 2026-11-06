import {createSiteRouter,publicRouteRequest} from './shared/site-network-core.js';

const origin=self.location.origin,CACHE='site-network-route-v1';
const key=origin+'/network/_browser-route';
const router=createSiteRouter({origin,store:{
  async load(){const cache=await caches.open(CACHE),response=await cache.match(key);return response?.json();},
  async save(value){const cache=await caches.open(CACHE);await cache.put(key,Response.json(value));}
}});
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{await self.clients.claim();await router.prepare();})()));
self.addEventListener('fetch',event=>{
  if(!publicRouteRequest(event.request,origin))return;
  event.respondWith(router.handle(event.request));
  event.waitUntil(router.prepare());
});
self.addEventListener('message',event=>{
  if(event.source?.url&&new URL(event.source.url).origin!==origin)return;
  if(event.data?.type==='site-network-warm')event.waitUntil(router.prepare());
  if(event.data?.type==='site-network-status')event.waitUntil(router.initialize().then(()=>event.ports[0]?.postMessage(router.status())));
});
