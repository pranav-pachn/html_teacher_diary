const CACHE_NAME = 'teacher-diary-v56';
const ASSETS = [
    './',
    './index.html',
    './dashboard.html',
    './slow_learner.html',
    './config/schools.v1.json',
    './css/styles.css',
    './css/slow_learner.css',
    './js/boot.js',
    './js/data.js',
    './js/toast.js',
    './js/env.js',
    './js/supabase.js',
    './js/file-upload.js',
    './js/storage-manager.js',
    './js/api.js',
    './js/csv.js',
    './js/auth.js',
    './js/approval.js',
    './js/history.js',
    './js/ui.js',
    './js/curriculum.js',
    './js/autocomplete.js',
    './js/tour.js',
    './js/timetable.js',
    './js/admin.js',
    './js/principal.js',
    './js/notifications.js',
    './js/slow_learner.js',
    './js/app.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return Promise.all(
                ASSETS.map(url => {
                    return fetch(new Request(url, { cache: 'reload' }))
                        .then(response => {
                            if (!response.ok) throw new Error('Network response was not ok');
                            return cache.put(url, response);
                        });
                })
            ).catch(err => {
                console.warn('Service worker install warning:', err);
            });
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    // We only want to cache GET requests for our own origin
    if (event.request.method !== 'GET') return;
    
    const url = new URL(event.request.url);
    if (!url.origin.includes(location.origin)) return;
    
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    });
                }
                return networkResponse;
            }).catch(() => {
                console.warn('Network request failed and not in cache:', event.request.url);
            });
        })
    );
});
