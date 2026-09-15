    // ─────────── Web Push (FCM) — réveiller l'onglet fermé ───────────
    // La config Firebase et la clé VAPID viennent de firebase-config.js
    // (source de vérité unique, partagée avec sw.js).
    const VAPID_PUBLIC_KEY = window.YAM_VAPID_PUBLIC_KEY || "BJtX1Wj7pUoLl6ALPz_Izz1_0mrRGsg5StuNAY_sFpb8aoGZgesJv0o6AZ8pRCoQPjSr2a_yCiG1JyFN0XRh-fA";

    function loadFirebaseCompat() {
      return new Promise((resolve, reject) => {
        if (window.firebase && window.firebase.messaging) { resolve(); return; }
        const scripts = [
          "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js",
          "https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js",
        ];
        let loaded = 0;
        scripts.forEach((src) => {
          const s = document.createElement("script");
          s.src = src;
          s.onload = () => { loaded++; if (loaded === scripts.length) resolve(); };
          s.onerror = () => reject(new Error("Échec chargement SDK Firebase: " + src));
          document.head.appendChild(s);
        });
      });
    }

    async function registerWebPush() {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
          console.warn("[push] Service Worker / Web Push non supporté");
          return;
        }
        const reg = await navigator.serviceWorker.register("/sw.js");
        console.log("[push] Service Worker enregistré");

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          console.warn("[push] Permission notification refusée");
          return;
        }

        await loadFirebaseCompat();
        const app = firebase.initializeApp(window.YAM_FIREBASE_CONFIG || {
          apiKey: "AIzaSyDdvlw8j9HTSbxRdir0L67v5XKdsellimY",
          authDomain: "projetyam-eddc1.firebaseapp.com",
          projectId: "projetyam-eddc1",
          storageBucket: "projetyam-eddc1.firebasestorage.app",
          messagingSenderId: "110051295714",
          appId: "1:110051295714:web:1cf81058bf2aa3016e79bb",
          measurementId: "G-SYF2XDG54K",
        });
        const messaging = firebase.messaging(app);
        const token = await messaging.getToken({
          vapidKey: VAPID_PUBLIC_KEY,
          serviceWorkerRegistration: reg,
        });
        console.log("[push] Token FCM obtenu");

        // Enregistre le device avec le token FCM dans le backend.
        const cleanBase = serverUrl.replace(/\/+$/, "");
        const response = await fetch(cleanBase + "/api/v1/devices/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${localStorage.getItem("auth_token") || ""}`,
          },
          body: JSON.stringify({
            label: myUserName,
            device_id: myDeviceId,
            platform: "web",
            fcm_token: token,
          }),
        });
        if (!response.ok) {
          throw new Error("Enregistrement FCM refusé (HTTP " + response.status + ")");
        }
        console.log("[push] Token FCM enregistré côté serveur");
      } catch (err) {
        console.warn("[push] Erreur Web Push", err);
      }
    }
