// =========================================================
// push.js — Enregistre le client web pour les notifications
// push via Firebase Cloud Messaging (FCM) afin de recevoir
// les appels même quand l'onglet est fermé.
//
// NB : on utilise les builds "compat" 9.x de Firebase car les
// builds 10.x+ (ES modules) ne sont pas compatibles avec
// importScripts() dans un Service Worker.
// =========================================================

// Configuration Firebase web (projet projetyam-eddc1).
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDdvlw8j9HTSbxRdir0L67v5XKdsellimY",
  authDomain: "projetyam-eddc1.firebaseapp.com",
  projectId: "projetyam-eddc1",
  storageBucket: "projetyam-eddc1.firebasestorage.app",
  messagingSenderId: "110051295714",
  appId: "1:110051295714:web:1cf81058bf2aa3016e79bb",
  measurementId: "G-SYF2XDG54K",
};

// Clé VAPID publique (console Firebase → Project settings → Cloud Messaging
// → Web Push certificates → Key pair).
const VAPID_PUBLIC_KEY = "BJtX1Wj7pUoLl6ALPz_Izz1_0mrRGsg5StuNAY_sFpb8aoGZgesJv0o6AZ8pRCoQPjSr2a_yCiG1JyFN0XRh-fA";

/**
 * Enregistre le Service Worker et le token FCM.
 * À appeler après l'enregistrement du device (registerCurrentDevice).
 */
async function registerWebPush(apiBase, deviceId) {
  try {
    if (!("serviceWorker" in navigator)) {
      console.warn("[push] Service Worker non supporté");
      return;
    }
    if (!("PushManager" in window)) {
      console.warn("[push] Web Push non supporté");
      return;
    }

    // Enregistre le Service Worker (nécessaire pour FCM web).
    const reg = await navigator.serviceWorker.register("/sw.js");
    console.log("[push] Service Worker enregistré");

    // Demande la permission de notification.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("[push] Permission notification refusée");
      return;
    }

    // Charge le SDK Firebase Messaging (compat 9.x) depuis le CDN.
    await loadFirebaseCompat();

    // Initialise Firebase et obtient le token FCM.
    const app = firebase.initializeApp(FIREBASE_CONFIG);
    const messaging = firebase.messaging(app);
    const token = await messaging.getToken({
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: reg,
    });
    console.log("[push] Token FCM obtenu");

    // Enregistre le token FCM dans le backend.
    const response = await fetch(`${apiBase}/devices/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${localStorage.getItem("auth_token") || ""}`,
      },
      body: JSON.stringify({
        label: localStorage.getItem("device_label") || `Web ${deviceId.slice(-4)}`,
        device_id: deviceId,
        platform: "web",
        fcm_token: token,
      }),
    });
    if (!response.ok) {
      throw new Error("Enregistrement FCM refusé (HTTP " + response.status + ")");
    }
    console.log("[push] Token FCM enregistré côté serveur");
  } catch (err) {
    console.warn("[push] Erreur enregistrement Web Push", err);
  }
}

/**
 * Charge le SDK Firebase Messaging (compat 9.x) de façon dynamique.
 * Retourne une promesse résolue quand les scripts sont chargés.
 */
function loadFirebaseCompat() {
  return new Promise((resolve, reject) => {
    if (window.firebase && window.firebase.messaging) {
      resolve();
      return;
    }
    const scripts = [
      "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
      "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js",
    ];
    let loaded = 0;
    scripts.forEach((src) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => {
        loaded++;
        if (loaded === scripts.length) resolve();
      };
      s.onerror = () => reject(new Error("Échec chargement SDK Firebase: " + src));
      document.head.appendChild(s);
    });
  });
}
