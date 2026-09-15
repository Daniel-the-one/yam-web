
    // Connect WebSocket & Runtime Config
    async function initNetwork() {
      setStatus("connecting");
      try {
        const cleanBase = serverUrl.replace(/\/+$/, "");
        const cfgRes = await fetch(cleanBase + "/api/v1/config").catch(() => null);
        let appKey = "local";
        let cluster = "eu";

        if (cfgRes && cfgRes.ok) {
          const cfg = await cfgRes.json();
          if (cfg.pusher) {
            appKey = cfg.pusher.app_key || "local";
            cluster = cfg.pusher.cluster || "eu";
          }
          if (cfg.ice_servers && Array.isArray(cfg.ice_servers)) {
            iceServersConfig = cfg.ice_servers;
          } else if (cfg.turn && cfg.turn.url) {
            const urls = cfg.turn.url.split(",").map(u => u.trim());
            iceServersConfig = [
              { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] },
              { urls: ["stun:stun.cloudflare.com:3478"] },
              ...urls.map(u => ({
                urls: u,
                username: cfg.turn.username || "openrelay",
                credential: cfg.turn.credential || "openrelay"
              }))
            ];
          }
        }

        if (pusher) {
          try { pusher.disconnect(); } catch (_) {}
        }

        // Connexion à Pusher.com (SaaS) : le SDK choisit automatiquement le
        // bon endpoint wss://ws-{cluster}.pusher.com à partir de la clé et du cluster.
        // authEndpoint + auth.headers : permet de s'abonner aux canaux PRIVÉS
        // (private-user.{id}) — le serveur valide le token Sanctum via
        // POST /broadcasting/auth (BroadcastServiceProvider, auth:sanctum).
        pusher = new Pusher(appKey, {
          cluster: cluster,
          forceTLS: true,
          authEndpoint: cleanBase + "/broadcasting/auth",
          auth: {
            headers: { Authorization: "Bearer " + (authToken() || "") }
          }
        });

        pusher.connection.bind("connected", () => setStatus("connected"));
        pusher.connection.bind("connecting", () => setStatus("connecting"));
        pusher.connection.bind("disconnected", () => setStatus("disconnected"));
        pusher.connection.bind("failed", () => setStatus("disconnected"));

        const channel = pusher.subscribe("device." + myDeviceId);
        channel.bind("incoming-call", handleIncomingCall);
        channel.bind("call-signal", handleCallSignal);

        // Canal PRIVÉ de l'utilisateur connecté : reçoit AppelLance (appel
        // facturé qui sonne) avec l'appel_id nécessaire au décrochage et au
        // heartbeat. L'événement est nommé "appel.lance" (broadcastAs).
        const myUserId = localStorage.getItem("user_id");
        if (myUserId) {
          const privateChannel = pusher.subscribe("private-user." + myUserId);
          privateChannel.bind("appel.lance", handleAppelLance);
        }
      } catch (err) {
        console.error("Init network error:", err);
        setStatus("disconnected");
      }
    }

    // Gestion automatique des changements de réseau (Wi-Fi ↔ 4G)
    window.addEventListener("online", () => {
      console.log("[YAM] Réseau reconnecté → relance signalisation...");
      initNetwork();
    });
    window.addEventListener("offline", () => {
      console.log("[YAM] Réseau hors ligne");
      setStatus("disconnected");
    });

    // Reconnexion automatique si perte de WebSocket
    setInterval(() => {
      if (pusher && (pusher.connection.state === "disconnected" || pusher.connection.state === "failed")) {
        if (!peerConnection && !activeOverlay.classList.contains("active")) {
          console.log("[YAM] Auto-reconnexion WebSocket en cours...");
          initNetwork();
        }
      }
    }, 7000);

    let titleInterval = null;
    function startTitleBlink(text) {
      let isAlt = false;
      const original = "Yam — Appels Audio WebRTC";
      if (titleInterval) clearInterval(titleInterval);
      titleInterval = setInterval(() => {
        document.title = isAlt ? "📞 (" + text + ")" : "🔔 Appel entrant !";
        isAlt = !isAlt;
      }, 800);
    }
    function stopTitleBlink() {
      if (titleInterval) clearInterval(titleInterval);
      titleInterval = null;
      document.title = "Yam — Appels Audio WebRTC";
    }

    // Demande de permission notification
    document.addEventListener("click", () => {
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    }, { once: true });

