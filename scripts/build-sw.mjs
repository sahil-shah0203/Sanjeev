import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
const build = (await readFile("apps/web/.next/BUILD_ID", "utf8")).trim();
async function files(dir, prefix) {
  const output = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory())
      output.push(
        ...(await files(path.join(dir, item.name), `${prefix}/${item.name}`)),
      );
    else if (!item.name.endsWith(".map")) output.push(`${prefix}/${item.name}`);
  }
  return output;
}
const assets = [
  ...(await files("apps/web/.next/static", "/_next/static")),
  "/wasm/sql-wasm.wasm",
  "/favicon.svg",
  "/manifest.webmanifest",
];
const shell = [
  "/",
  "/decks",
  "/browse",
  "/progress",
  "/settings",
  "/import",
  "/review-content",
  "/study/offline",
];
const worker = `const CACHE=${JSON.stringify(`recall-shell-${build}`)};
const ASSETS=${JSON.stringify(assets)};
const SHELL=${JSON.stringify(shell)};
async function cacheShell(){const cache=await caches.open(CACHE);await cache.addAll([...ASSETS,...SHELL]);}
self.addEventListener('install',event=>event.waitUntil(cacheShell()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{if(event.data?.type==='CACHE_SHELL')event.waitUntil(cacheShell().then(()=>event.ports[0]?.postMessage({ok:true})).catch(()=>event.ports[0]?.postMessage({ok:false})));if(event.data?.type==='ACTIVATE_AFTER_SESSION')self.skipWaiting();});
self.addEventListener('fetch',event=>{const request=event.request;const url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/'))return;
if(request.mode==='navigate'){event.respondWith(fetch(request).catch(async()=>{const cache=await caches.open(CACHE);return await cache.match(url.pathname)||await cache.match('/')||Response.error();}));return;}
if(url.pathname.startsWith('/_next/static/')||url.pathname.startsWith('/wasm/')||url.pathname.startsWith('/fonts/')||ASSETS.includes(url.pathname)){event.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;}));}
});`;
await writeFile("apps/web/public/sw.js", worker);
console.log(
  `Offline shell ${build}: ${assets.length} static assets, ${shell.length} routes.`,
);
