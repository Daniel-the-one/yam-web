// =========================================================
// incoming-call-listener.js — Écoute les appels entrants en temps réel
// via Laravel Reverb (compatible avec le protocole Pusher)
// =========================================================

let REVERB_APP_KEY = "local";

function getHostConfig() {
  const host = window.location.hostname || "192.168.1.80";
  const isLocal = host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.");
  const isTunnel = host.endsWith("trycloudflare.com");

  if (isLocal) {
    return {
      host: host,
      apiBase: `http://${host}:8000/api/v1`,
      wsHost: host,
      wsPort: 8080,
      forceTLS: false,
      transports: ["ws", "wss"]
    };
  }

  // Tunnel HTTPS (cloudflared) : l'API et le client sont servis depuis le
  // même hôte ; le host WebSocket est fourni par l'endpoint /config.
  if (isTunnel) {
    return {
      host: host,
      apiBase: `${window.location.protocol}//${host}/api/v1`,
      wsHost: host,
      wsPort: 443,
      forceTLS: true,
      transports: ["ws", "wss"]
    };
  }

  return {
    host: "web-production-6a2e0.up.railway.app",
    apiBase: "https://web-production-6a2e0.up.railway.app/api/v1",
    wsHost: "web-production-6a2e0.up.railway.app",
    wsPort: 443,
    forceTLS: true,
    transports: ["ws", "wss"]
  };
}

let hostConfig = getHostConfig();
let SERVER_HOST = hostConfig.host;
let API_BASE_URL = hostConfig.apiBase;
let API_CONFIG_URL = `${API_BASE_URL}/config`;
let API_RING_URL = `${API_BASE_URL}/call/ring`;
let API_SIGNAL_URL = `${API_BASE_URL}/call/signal`;

async function hydrateRuntimeConfig() {
  try {
    const res = await fetch(API_CONFIG_URL, { cache: "no-store" });
    if (!res.ok) return;
    const cfg = await res.json();

    if (cfg.reverb?.app_key) REVERB_APP_KEY = cfg.reverb.app_key;
    if (cfg.reverb?.host) {
      const scheme = cfg.reverb.scheme === "https" ? "https" : "http";
      const isHttps = scheme === "https";
      const httpPort = window.location.port ? `:${window.location.port}` : (isHttps ? "" : ":8000");
      hostConfig = {
        host: cfg.reverb.host,
        apiBase: `${scheme}://${cfg.reverb.host}${httpPort}/api/v1`,
        wsHost: cfg.reverb.host,
        wsPort: isHttps ? 443 : (cfg.reverb.port || 6001),
        forceTLS: isHttps,
        // ⚠️ JAMAIS ["wss"] seul : le SDK Pusher échoue immédiatement
        // (initialized → failed) quand enabledTransports est restreint à wss.
        transports: ["ws", "wss"],
      };
      // Met à jour les constantes de base pour que les fetch (ring, signal,
      // offer) utilisent la config runtime et non la config par défaut.
      SERVER_HOST = hostConfig.host;
      API_BASE_URL = hostConfig.apiBase;
      API_CONFIG_URL = `${API_BASE_URL}/config`;
      API_RING_URL = `${API_BASE_URL}/call/ring`;
      API_SIGNAL_URL = `${API_BASE_URL}/call/signal`;
    }

    if (cfg.turn?.url) {
      window.__TURN_CONFIG__ = {
        url: cfg.turn.url,
        username: cfg.turn.username || "",
        credential: cfg.turn.credential || "",
      };
    }
  } catch (err) {
    console.warn("[runtime-config] impossible de charger la config distante", err);
  }
}

// Lance le chargement de la config runtime immédiatement et expose la
// promesse : les pages qui créent un client Pusher (incoming-call.html,
// call.html) doivent l'attendre pour ne pas se connecter au mauvais hôte.
window.__runtimeConfigReady = hydrateRuntimeConfig();

// Garantir que device_id existe immédiatement
let currentDeviceId = localStorage.getItem("device_id");
if (!currentDeviceId) {
  currentDeviceId = "device-" + Math.random().toString(36).substring(2, 10);
  localStorage.setItem("device_id", currentDeviceId);
}

async function registerCurrentDevice() {
  const label = localStorage.getItem("device_label") || `Web ${currentDeviceId.slice(-4)}`;
  try {
    await fetch(`${hostConfig.apiBase}/devices/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label,
        device_id: currentDeviceId,
        platform: "web",
      }),
    });
    console.log("[device-registry] ✅ Enregistré côté serveur", currentDeviceId, label);
  } catch (err) {
    console.warn("[device-registry] Enregistrement du device impossible", err);
  }
}

registerCurrentDevice();

// Enregistre le Web Push (Service Worker + subscription) pour recevoir
// les appels même quand l'onglet est fermé.
if (typeof registerWebPush === "function") {
  registerWebPush(hostConfig.apiBase, currentDeviceId);
}

function sdpNormalise(sdp) {
  if (typeof sdp !== "string") return sdp;
  return sdp.endsWith("\r\n") ? sdp : sdp + "\r\n";
}

document.addEventListener("DOMContentLoaded", async () => {
  await window.__runtimeConfigReady;

  // N'écouter les appels entrants globaux que si on n'est PAS déjà sur call.html ou incoming-call.html
  const isCallPage = window.location.pathname.endsWith("call.html") || 
                     window.location.pathname.endsWith("incoming-call.html");
  if (isCallPage) return;

  if (typeof Pusher === "undefined") {
    console.warn("[incoming-call] Pusher JS n'est pas chargé");
    return;
  }

  const pusher = new Pusher(REVERB_APP_KEY, {
    wsHost: hostConfig.wsHost,
    wsPort: hostConfig.wsPort,
    wssPort: hostConfig.wsPort,
    forceTLS: hostConfig.forceTLS,
    cluster: "",
  });

  pusher.connection.bind("state_change", (states) => {
    console.log("[incoming-call] Pusher state:", states.current);
  });

  const channel = pusher.subscribe("device." + currentDeviceId);
  console.log("[incoming-call] Écoute sur le canal device." + currentDeviceId);

  channel.bind("incoming-call", (data) => {
    console.log("[incoming-call] Appel entrant reçu:", data);
    sessionStorage.setItem("incoming_call_id", data.call_id);
    sessionStorage.setItem("incoming_call_from_device_id", data.from_device_id);
    sessionStorage.setItem("incoming_call_from", data.from_username);
    sessionStorage.setItem("incoming_call_type", data.type || "audio");
    window.location.href = "incoming-call.html";
  });
});
