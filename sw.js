// Pet Streak service worker: shows feeding reminders and opens the app when one is tapped, and keeps a saved copy
// of the app on the phone so it opens quickly on a slow connection.
//  - The page: from the internet first, so updates arrive. If that takes longer than a few seconds and a saved
//    copy exists, the saved copy opens instead (and the newer page is saved for next time).
//  - The 3D model and the food (pet-model.js?v=..., food-pack.js?v=...) and the three.js / Supabase scripts: saved once and reused. Their addresses
//    change when they change, so an old copy is never used by mistake.
//  - Fur textures and pictures: the saved copy at once, refreshed in the background.
//  - The game's data (Supabase) is never saved here.
var CACHE = "pet-streak-v1";
var PAGE_KEY = "pet-streak-page";
var PAGE_WAIT = 4000;

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function savedCopy(req) { return caches.open(CACHE).then(function (c) { return c.match(req); }); }
function save(req, res) {
  // (CDN scripts arrive "opaque": no status is visible, but they are fine to keep)
  if (!res || !(res.ok || res.type === "opaque")) return Promise.resolve();
  var copy = res.clone();
  return caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {});
}

// the page: internet first, the saved copy if the internet is too slow or away
function pageFirst(e) {
  // take the copy to save as soon as the page arrives, before the browser starts reading it
  var got = fetch(e.request).then(function (res) { return { res: res, copy: res.ok ? res.clone() : null }; });
  e.waitUntil(got.then(function (x) {
    if (x.copy) return caches.open(CACHE).then(function (c) { return c.put(PAGE_KEY, x.copy); });
  }).catch(function () {}));
  var fresh = got.then(function (x) { return x.res; });
  var slow = new Promise(function (resolve) { setTimeout(resolve, PAGE_WAIT); }).then(function () { return savedCopy(PAGE_KEY); });
  var offline = fresh.catch(function () { return savedCopy(PAGE_KEY); });
  return new Promise(function (resolve, reject) {
    var done = false;
    function pick(res) { if (!done && res) { done = true; resolve(res); } }
    fresh.then(pick, function () {});
    slow.then(pick);
    offline.then(function (res) { if (res) pick(res); else if (!done) fresh.then(pick, reject); });
  });
}
// "update now": always from the internet, saved as the page for next time before answering
function pageFresh(e) {
  return fetch(e.request.url, { cache: "no-store" }).then(function (res) {
    if (!res.ok) return res;
    var copy = res.clone();
    return caches.open(CACHE).then(function (c) { return c.put(PAGE_KEY, copy); }).then(function () { return res; });
  });
}
// files whose address changes when they change: the saved copy if there is one, else download and save
function savedFirst(e) {
  var saving = null;
  var answer = savedCopy(e.request).then(function (hit) {
    if (hit) return hit;
    return fetch(e.request).then(function (res) {
      saving = save(e.request, res.clone()).then(function () { return dropOldModels(e.request.url); });
      return res;
    });
  });
  // keep the worker alive until the copy is saved
  e.waitUntil(answer.then(function () { return saving; }).catch(function () {}));
  return answer;
}
function dropOldModels(url) {
  var file = /pet-model\.js|food-pack\.js/.exec(url);
  if (!file) return;
  return caches.open(CACHE).then(function (c) {
    return c.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.url.indexOf(file[0]) >= 0 && k.url !== url; }).map(function (k) { return c.delete(k); }));
    });
  });
}
// pictures: the saved copy straight away, and a fresh one saved in the background
function savedThenRefresh(e) {
  var got = fetch(e.request).then(function (res) { return { res: res, copy: res.ok ? res.clone() : null }; });
  e.waitUntil(got.then(function (x) {
    if (x.copy) return caches.open(CACHE).then(function (c) { return c.put(e.request, x.copy); });
  }).catch(function () {}));
  return savedCopy(e.request).then(function (hit) { return hit || got.then(function (x) { return x.res; }); });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    var path = url.pathname;
    // only the app page itself (not prototype.html or other pages)
    if (/\/(index\.html)?$/.test(path)) { e.respondWith(url.searchParams.has("fresh") ? pageFresh(e) : pageFirst(e)); return; }
    if (/\/(pet-model|food-pack)\.js$/.test(path)) { e.respondWith(savedFirst(e)); return; }
    if (/\/(pets|icons)\/|\/icon-\d+\.png$|\/manifest\.json$/.test(path)) { e.respondWith(savedThenRefresh(e)); return; }
    return;
  }
  // three.js and the Supabase library come from a CDN at fixed versions
  if (url.hostname === "cdn.jsdelivr.net") { e.respondWith(savedFirst(e)); return; }
});

self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Pet Streak", {
    body: d.body || "",
    tag: d.tag || "pet-streak",
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: "./" }
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ("focus" in list[i]) return list[i].focus(); }
    return self.clients.openWindow(e.notification.data && e.notification.data.url || "./");
  }));
});
