// =========================================================
// sw.js — Service Worker Yam : gère les notifications push
// via Firebase Cloud Messaging (FCM) pour réveiller le client
// web quand l'onglet est fermé.
// =========================================================

// Importe le SDK Firebase Messaging pour Service Worker (builds compat 9.x pour importScripts).
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");
// Config Firebase partagée (source de vérité unique avec spa-push.js).
importScripts("js/firebase-config.js");

// Configuration Firebase web (projet projetyam-eddc1).
firebase.initializeApp(YAM_FIREBASE_CONFIG);

const messaging = firebase.messaging();

// ── Notification push reçue (appel entrant) ─────────────────────────
messaging.onBackgroundMessage((payload) => {
  console.log("[sw] Notification push reçue:", payload);

  const data = payload.data || {};
  const fromUsername = data.from_username || "Inconnu";
  // Le backend envoie le type d'appel dans `media` (audio|video) et `type`
  // vaut toujours "incoming". On lit `media` en priorité, avec repli sur
  // `type` pour les anciens payloads.
  const type = (data.media === "video" || data.media === "audio")
    ? data.media
    : (data.type === "video" ? "video" : "audio");
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
      from_user_id: data.from_user_id || "",
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
      // Ne focuser que la fenêtre Yam (app.html / index.html), pas le premier
      // onglet trouvé (mail, YouTube...). Sinon le postMessage avec les
      // données d'appel arrive sur le mauvais onglet.
      const yamClient = clientList.find((c) =>
        c.url.includes("/app.html") || c.url.includes("/index.html")
      );
      if (yamClient && "focus" in yamClient) {
        yamClient.focus();
        yamClient.postMessage({
          type: "YAM_INCOMING_CALL",
          call_id: data.call_id,
          from_device_id: data.from_device_id,
          from_username: data.from_username,
          from_user_id: data.from_user_id || "",
          call_type: data.type,
        });
        return;
      }
      // Aucune fenêtre Yam : ouvrir le SPA avec les données d'appel
      // en query params (le SPA les lit au démarrage pour afficher l'appel).
      const callUrl = new URL(url, self.location.origin);
      callUrl.searchParams.set("call_id", data.call_id || "");
      callUrl.searchParams.set("from_device_id", data.from_device_id || "");
      callUrl.searchParams.set("from_username", data.from_username || "");
      callUrl.searchParams.set("from_user_id", data.from_user_id || "");
      callUrl.searchParams.set("call_type", data.type || "audio");
      return clients.openWindow(callUrl.toString());
    })
  );
});
