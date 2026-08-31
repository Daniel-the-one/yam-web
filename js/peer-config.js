// =========================================================
// peer-config.js — Configuration WebRTC (STUN + TURN optionnel)
//
// En production, on branche un TURN si l'URL est fournie par
// l'environnement / le build. Cela évite les coupures audio quand
// le navigateur ne peut pas établir de P2P direct derrière NAT.
// =========================================================

function getIceServers() {
  const baseServers = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];

  const turnConfig = window.__TURN_CONFIG__ || {
    url: localStorage.getItem("turn_url") || "",
    username: localStorage.getItem("turn_username") || "",
    credential: localStorage.getItem("turn_credential") || localStorage.getItem("turn_password") || "",
  };

  if (!turnConfig.url) return { iceServers: baseServers, bundlePolicy: "max-bundle", rtcpMuxPolicy: "require" };

  return {
    iceServers: [
      ...baseServers,
      {
        urls: turnConfig.url,
        username: turnConfig.username || undefined,
        credential: turnConfig.credential || undefined,
      },
    ],
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  };
}

const ICE_SERVERS = getIceServers();
