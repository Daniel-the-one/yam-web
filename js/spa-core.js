    // YAM WEB CLIENT — Client WebRTC Complet et Réactif
    // =========================================================

    function getDefaultServerUrl() {
      const hostname = window.location.hostname || "127.0.0.1";
      const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname.startsWith("192.168.");
      if (isLocal) {
        return `http://${hostname}:8000`;
      }
      if (window.location.origin && window.location.origin.startsWith("http")) {
        return window.location.origin;
      }
      return "http://" + hostname + ":8000";
    }

    let savedServerUrl = localStorage.getItem("yam_server_url");
    let serverUrl = savedServerUrl || getDefaultServerUrl();
    // Si l'URL stockée pointe vers un ancien hôte LAN ou un tunnel expiré, réaligner
    if (savedServerUrl && (savedServerUrl.includes("192.168.36.227") || savedServerUrl.includes("trycloudflare") || (window.location.hostname && !savedServerUrl.includes(window.location.hostname)))) {
      serverUrl = getDefaultServerUrl();
      localStorage.setItem("yam_server_url", serverUrl);
    }

    let myDeviceId = localStorage.getItem("yam_device_id");
    if (!myDeviceId) {
      myDeviceId = "device-" + Math.random().toString(36).substring(2, 10);
      localStorage.setItem("yam_device_id", myDeviceId);
    }
    let myUserName = localStorage.getItem("yam_user_name") || ("Web " + myDeviceId.slice(-4));

    let pusher = null;
    let peerConnection = null;
    let localStream = null;
    let pendingOffer = null;
    let pendingCandidates = [];
    let isAcceptRequested = false;
    let isAnswered = false;
    let currentCallPeerId = null;
    let currentCallPeerName = null;
    let currentCallTargetUserId = null;
    let currentCallId = null;
    let callTimerInterval = null;
    let callStartTime = null;
    let ringbackTimeout = null;
    let disconnectGraceTimeout = null;
    let isMicMuted = false;
    let isCameraOn = false;
    let currentCallType = "audio"; // "audio" | "video"
    let iceServersConfig = [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] },
      { urls: ["stun:stun.cloudflare.com:3478"] },
      { urls: "turn:openrelay.metered.ca:80", username: "openrelay", credential: "openrelay" },
      { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelay", credential: "openrelay" },
      { urls: "turns:openrelay.metered.ca:443?transport=tcp", username: "openrelay", credential: "openrelay" }
    ];

    // UI Elements
    const statusDot = document.getElementById("status-dot");
    const statusLabel = document.getElementById("status-label");
    const myDeviceIdEl = document.getElementById("my-device-id");
    const myDeviceNameEl = document.getElementById("my-device-name");
    const targetInput = document.getElementById("target-device-input");
    const btnStartCall = document.getElementById("btn-start-call");
    const btnCopyId = document.getElementById("btn-copy-id");
    const btnEditName = document.getElementById("btn-edit-name");
    const btnSettings = document.getElementById("btn-settings");
    const contactsListEl = document.getElementById("contacts-list");
    const historyListEl = document.getElementById("history-list");
    const incomingOverlay = document.getElementById("incoming-overlay");
    const activeOverlay = document.getElementById("active-call-overlay");
    const remoteAudio = document.getElementById("remote-audio");
    const ringtoneAudio = document.getElementById("ringtone-audio");
    const ringbackAudio = document.getElementById("ringback-audio");

    function updateIdentityUI() {
      myDeviceIdEl.textContent = myDeviceId;
      myDeviceNameEl.textContent = myUserName;
    }

