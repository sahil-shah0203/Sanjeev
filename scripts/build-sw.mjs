import { readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
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
export async function buildOfflineShell(
  distDir = "apps/web/.next",
  publicDir = "apps/web/public",
) {
  const assets = [
    ...(await files(path.join(distDir, "static"), "/_next/static")),
    "/wasm/sql-wasm.wasm",
    "/favicon.svg",
    "/manifest.webmanifest",
  ];
  // The compiler hook runs before Vercel collects public assets. BUILD_ID and
  // build-manifest files can be written later, so version the actual asset list.
  const build = createHash("sha256")
    .update(JSON.stringify(assets.sort()))
    .digest("hex")
    .slice(0, 20);
  const shell = [
    "/",
    "/decks",
    "/browse",
    "/progress",
    "/settings",
    "/account",
    "/help",
    "/import",
    "/review-content",
    "/study/offline",
  ];
  const worker = `const CACHE=${JSON.stringify(`recall-shell-${build}`)};
const ASSETS=${JSON.stringify(assets)};
const SHELL=${JSON.stringify(shell)};
async function cacheShell(){const cache=await caches.open(CACHE);const urls=[...new Set([...ASSETS,...SHELL])];for(let i=0;i<urls.length;i+=8)await Promise.all(urls.slice(i,i+8).map(async url=>{const response=await fetch(new Request(url,{cache:'reload'}));if(!response.ok)throw new Error('Offline asset unavailable: '+url);await cache.put(url,response);}));}
self.addEventListener('install',event=>event.waitUntil(cacheShell()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{if(event.data?.type==='CACHE_SHELL')event.waitUntil(cacheShell().then(()=>event.ports[0]?.postMessage({ok:true})).catch(()=>event.ports[0]?.postMessage({ok:false})));if(event.data?.type==='ACTIVATE_AFTER_SESSION')self.skipWaiting();});
self.addEventListener('fetch',event=>{const request=event.request;const url=new URL(request.url);if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/'))return;
if(request.mode==='navigate'){event.respondWith(fetch(request).catch(async()=>{const cache=await caches.open(CACHE);return await cache.match(url.pathname)||await cache.match('/')||Response.error();}));return;}
if(url.pathname.startsWith('/_next/static/')||url.pathname.startsWith('/wasm/')||url.pathname.startsWith('/fonts/')||ASSETS.includes(url.pathname)){event.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;}));}
});`;
  await writeFile(path.join(publicDir, "sw.js"), worker);
  console.log(
    `Offline shell ${build}: ${assets.length} static assets, ${shell.length} routes.`,
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildOfflineShell();
