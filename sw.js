// =========================================================
// sw.js — Service Worker Yam : gère les notifications push
// via Firebase Cloud Messaging (FCM) pour réveiller le client
// web quand l'onglet est fermé.
// =========================================================

// Importe le SDK Firebase Messaging pour Service Worker (builds compat 9.x pour importScripts).
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

// Configuration Firebase web (projet projetyam-eddc1).
firebase.initializeApp({
  apiKey: "AIzaSyDdvlw8j9HTSbxRdir0L67v5XKdsellimY",
  authDomain: "projetyam-eddc1.firebaseapp.com",
  projectId: "projetyam-eddc1",
  storageBucket: "projetyam-eddc1.firebasestorage.app",
  messagingSenderId: "110051295714",
  appId: "1:110051295714:web:1cf81058bf2aa3016e79bb",
  measurementId: "G-SYF2XDG54K",
});

const messaging = firebase.messaging();

// ── Notification push reçue (appel entrant) ─────────────────────────
messaging.onBackgroundMessage((payload) => {
  console.log("[sw] Notification push reçue:", payload);

  const data = payload.data || {};
  const fromUsername = data.from_username || "Inconnu";
  const type = data.type || "audio";
  const callId = data.call_id || "";

  const title = type === "video"
    ? `Appel vidéo de ${fromUsername}`
    : `Appel de ${fromUsername}`;

  const options = {
    body: "Yam — appuyez pour répondre",
    icon: "/assets/icons/icon-192.png",
    badge: "/assets/icons/icon-192.png",
    tag: "yam-call-" + callId,
    renotify: true,
    vibrate: [400, 200, 400, 200, 400],
    data: {
      url: "/pages/incoming-call.html",
      call_id: callId,
      from_device_id: data.from_device_id || "",
      from_username: fromUsername,
      type: type,
    },
  };

  self.registration.showNotification(title, options);
});

// ── Clic sur la notification → ouvrir la page d'appel entrant ────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  const url = new URL(data.url || "/pages/incoming-call.html", self.location.origin);

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          client.postMessage({
            type: "YAM_INCOMING_CALL",
            call_id: data.call_id,
            from_device_id: data.from_device_id,
            from_username: data.from_username,
            call_type: data.type,
          });
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
