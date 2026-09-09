// =========================================================
// call.js — Logique de l'appel sortant (WebRTC audio/vidéo)
// =========================================================

let localStream = null;
let peerConnection = null;
let callTimer = null;
let callSeconds = 0;
let targetUserId = null;   // id de l'utilisateur cible (résout tous ses devices)
let targetDeviceId = null; // device_id du correspondant, appris au premier signal answer
let myDeviceId = null;
let currentCallId = null;
const pendingRemoteCandidates = [];
let isAnswered = false;
let byeSignalSent = false;
let ended = false;
let callType = "audio"; // "audio" | "video"
let cameraOn = false;

const statusEl  = () => document.getElementById("call-status");
const timerEl   = () => document.getElementById("call-timer");
const nameEl    = () => document.getElementById("call-name");
const avatarEl  = () => document.getElementById("call-avatar");
const hangupBtn = () => document.getElementById("btn-hangup");
const camBtn    = () => document.getElementById("btn-camera");
const localVideoEl = () => document.getElementById("local-video");
const remoteVideoEl = () => document.getElementById("remote-video");

let ringbackAudio = null;

// ---------------------------------------------------------
// Sonnerie de sortie (tonalité d'attente / ringback)
// ---------------------------------------------------------
function startRingback() {
  if (ringbackAudio || isAnswered) return;
  try {
    ringbackAudio = new Audio("../sounds/freesound_community-ring-tone-68676 (1).mp3");
    ringbackAudio.loop = true;
    const playPromise = ringbackAudio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn("[call] Autoplay ringback en attente d'interaction :", err.message);
        const unlockRingback = () => {
          if (ringbackAudio && !isAnswered) {
            ringbackAudio.play().catch(() => {});
          }
          window.removeEventListener("click", unlockRingback);
          window.removeEventListener("touchstart", unlockRingback);
        };
        window.addEventListener("click", unlockRingback);
        window.addEventListener("touchstart", unlockRingback);
      });
    }
  } catch (e) {
    console.warn("[call] Erreur initialisation ringback :", e);
  }
}

function stopRingback() {
  if (ringbackAudio) {
    try {
      ringbackAudio.pause();
      ringbackAudio.currentTime = 0;
    } catch (_) {}
    ringbackAudio = null;
  }
}

// ---------------------------------------------------------
// Contourne la politique d'autoplay : certains navigateurs
// bloquent la lecture audio sur une page où l'utilisateur
// n'a pas encore interagi (cas de l'appelant arrivé par
// navigation depuis contacts.html). On retente donc la
// lecture au premier clic/tap/touche tant qu'elle échoue.
// ---------------------------------------------------------
function attachAutoplayUnlock(audio) {
  const unlockEvents = ["click", "touchstart", "keydown"];
  const tryPlay = () => {
    audio.play()
      .then(() => {
        console.log("[call] 🔊 Audio distant en lecture.");
        unlockEvents.forEach((e) => window.removeEventListener(e, unlock));
      })
      .catch(() => console.warn("[call] ⏳ Lecture audio en attente d'un geste utilisateur..."));
  };
  const unlock = () => tryPlay();
  unlockEvents.forEach((e) => window.addEventListener(e, unlock));
  tryPlay();
}

function showStatus(text) {
  if (statusEl()) statusEl().textContent = text;
  const vStatus = document.getElementById("v-status");
  if (vStatus) vStatus.textContent = text;
}

document.addEventListener("DOMContentLoaded", async () => {
  // Attend la config runtime (Reverb/TURN) avant de créer le client Pusher,
  // sinon on se connecte au mauvais hôte et aucun signal n'est reçu.
  if (window.__runtimeConfigReady) {
    await window.__runtimeConfigReady;
  }
  console.log("[call] 🌐 Config réseau:", JSON.stringify(hostConfig));
  targetUserId = sessionStorage.getItem("call_target_user_id");
  const targetUsername = sessionStorage.getItem("call_target_username") || "Inconnu";
  callType = sessionStorage.getItem("call_type") === "video" ? "video" : "audio";
  cameraOn = callType === "video";
  
  myDeviceId = localStorage.getItem("device_id");
  if (!myDeviceId) {
    myDeviceId = "device-" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem("device_id", myDeviceId);
  }
  console.log("[call] 🆔 Mon device_id:", myDeviceId, "| Cible user_id:", targetUserId, "| Type:", callType);

  if (!targetUserId) {
    showStatus("Aucun utilisateur cible.");
    return;
  }

  if (nameEl()) nameEl().textContent = targetUsername;
  if (avatarEl()) avatarEl().textContent = targetUsername.charAt(0).toUpperCase();
  const vNameEl = document.getElementById("v-name");
  if (vNameEl) vNameEl.textContent = targetUsername;

  // 1. Obtenir le micro (et la caméra si appel vidéo)
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callType === "video",
    });
    showStatus("Connexion en cours...");
  } catch (err) {
    showStatus("Micro refusé. Veuillez autoriser le micro.");
    console.error("[call] getUserMedia error:", err);
    return;
  }

  // Afficher la vidéo locale (PIP) si appel vidéo
  if (callType === "video" && localVideoEl()) {
    localVideoEl().srcObject = localStream;
    localVideoEl().style.display = "block";
  }

  // 2. Créer la PeerConnection
  peerConnection = new RTCPeerConnection(getIceServers());

  // Ajouter les pistes locales
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  // 🔊 RECEPTION DE LA VOIX/VIDEO DISTANTE (CRITIQUE)
  peerConnection.ontrack = (event) => {
    console.log("[call] 📡 Piste distante reçue !", event.track.kind, event.track.readyState);
    if (event.track.kind === "video") {
      const remoteVideo = remoteVideoEl();
      if (remoteVideo) {
        if (event.streams && event.streams[0]) {
          remoteVideo.srcObject = event.streams[0];
        } else {
          remoteVideo.srcObject = new MediaStream([event.track]);
        }
        remoteVideo.style.display = "block";
        document.body.classList.add("video-mode");
      }
    } else {
      let remoteAudio = document.getElementById("remote-audio");
      if (!remoteAudio) {
        remoteAudio = document.createElement("audio");
        remoteAudio.id = "remote-audio";
        remoteAudio.autoplay = true;
        remoteAudio.playsInline = true;
        document.body.appendChild(remoteAudio);
      }
      if (event.streams && event.streams[0]) {
        remoteAudio.srcObject = event.streams[0];
      } else {
        remoteAudio.srcObject = new MediaStream([event.track]);
      }
      attachAutoplayUnlock(remoteAudio);
    }
  };

  // ICE candidates locaux → envoyés au destinataire
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("[call] 🧊 Candidat local:", event.candidate.type,
        event.candidate.address || "", "| protocole:", event.candidate.protocol);
      sendSignal("candidate", {
        candidate: event.candidate.toJSON(),
      });
    } else {
      console.log("[call] 🧊 Rassemblement des candidats terminé.");
    }
  };

  // Suivi du rassemblement ICE (diagnostic réseau)
  peerConnection.onicegatheringstatechange = () => {
    console.log("[call] ❄️ ICE gathering:", peerConnection.iceGatheringState);
  };

  // État de la connexion
  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;
    console.log("[call] connectionState:", state, "| iceConnectionState:", peerConnection.iceConnectionState);

    if (state === "connected") {
      stopRingback();
      showStatus("Appel en cours...");
      startTimer();
    } else if (state === "failed" || state === "closed") {
      stopRingback();
      endCall("Appel terminé.");
    } else if (state === "disconnected") {
      // Délai de grâce : les coupures transitoires (Wi-Fi → 4G, rotation)
      // sont fréquentes en vidéo. Laisser ICE se reconnecter avant de tuer
      // l'appel (cohérent avec le mobile, 5 s).
      setTimeout(() => {
        if (peerConnection && peerConnection.connectionState === "disconnected") {
          stopRingback();
          endCall("Appel terminé.");
        }
      }, 5000);
    }
  };

  // 3. Écouter les signaux en retour (answer, candidates)
  setupSignalListener();

  // 4. Faire sonner et envoyer l'offre WebRTC
  try {
    // Créer l'offre WebRTC
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: callType === "video",
    });
    await peerConnection.setLocalDescription(offer);

    const sdpString = sdpNormalise(offer.sdp);

    // Faire sonner le destinataire (tous ses appareils)
    const ringHeaders = { "Content-Type": "application/json" };
    const ringToken = localStorage.getItem("auth_token");
    if (ringToken) ringHeaders["Authorization"] = `Bearer ${ringToken}`;
    const ringRes = await fetch(API_RING_URL, {
      method: "POST",
      headers: ringHeaders,
      body: JSON.stringify({
        to_user_id: targetUserId,
        from_device_id: myDeviceId,
        from_username: localStorage.getItem("user_name") || "Appelant",
        type: callType,
      }),
    });
    // Récupère le call_id pour le stockage différé de l'offre côté serveur.
    const ringData = await ringRes.json().catch(() => ({}));
    if (!ringRes.ok) {
      throw new Error(ringData.error?.message || "Échec de la sonnerie (HTTP " + ringRes.status + ")");
    }
    currentCallId = ringData.data?.call_id || ringData.call_id || null;
    console.log("[call] 📞 call_id:", currentCallId);

    // Démarrer la sonnerie d'attente (ringback)
    startRingback();

    // Envoyer l'offre SDP immédiatement
    sendSignal("offer", {
      sdp: { type: offer.type, sdp: sdpString }
    });

    // Répéter l'envoi de l'offre après 2s et 4s au cas où le récepteur charge encore sa page
    setTimeout(() => {
      if (!isAnswered) {
        sendSignal("offer", { sdp: { type: offer.type, sdp: sdpString } });
      }
    }, 2000);

    setTimeout(() => {
      if (!isAnswered) {
        sendSignal("offer", { sdp: { type: offer.type, sdp: sdpString } });
      }
    }, 4500);

  } catch (err) {
    showStatus("Erreur lors de l'initialisation de l'appel.");
    console.error("[call] createOffer error:", err);
  }

  // Bouton raccrocher
  if (hangupBtn()) {
    hangupBtn().addEventListener("click", () => {
      endCall("Appel raccroché.");
    });
  }
  const hangupVideoBtn = document.getElementById("btn-hangup-video");
  if (hangupVideoBtn) {
    hangupVideoBtn.addEventListener("click", () => {
      endCall("Appel raccroché.");
    });
  }

  // Bouton toggle caméra (appel vidéo uniquement)
  if (camBtn() && callType === "video") {
    camBtn().style.display = "flex";
    camBtn().addEventListener("click", toggleCamera);
  }
});

// ---- Signaling ----

function sendSignal(type, payload) {
  console.log(`[call] 📤 Envoi signal "${type}" → user ${targetUserId} / device ${targetDeviceId}`);
  const body = {
    from_device_id: myDeviceId,
    type: type,
    payload: payload,
  };
  // L'offre est routée vers l'utilisateur cible (tous ses appareils).
  // Les autres signaux (answer/candidate/bye) ciblent le device précis
  // appris au premier signal answer reçu.
  if (type === "offer") {
    body.to_user_id = targetUserId;
  } else if (type === "bye") {
    if (targetDeviceId) body.to_device_id = targetDeviceId;
    if (targetUserId) body.to_user_id = targetUserId;
  } else if (targetDeviceId) {
    body.to_device_id = targetDeviceId;
  }
  // Associe le call_id (stockage différé de l'offre + invalidation au bye).
  if (currentCallId) body.call_id = currentCallId;
  const headers = { "Content-Type": "application/json" };
  const token = localStorage.getItem("auth_token");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  fetch(API_SIGNAL_URL, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log(`[call] ✅ Signal "${type}" transmis par le serveur.`);
    })
    .catch((err) => console.error(`[call] ❌ Échec envoi signal "${type}":`, err));
}

function setupSignalListener() {
  const pusher = new Pusher(PUSHER_APP_KEY, {
    cluster: PUSHER_CLUSTER,
    forceTLS: true,
  });

  const channel = pusher.subscribe("device." + myDeviceId);

  channel.bind("call-signal", async (data) => {
    if (data.from_device_id === myDeviceId) {
      console.warn(`[call] ⚠️ Signal "${data.type}" ignoré (émis par mon propre device_id).`);
      return;
    }
    console.log("[call] 📥 Signal reçu:", data.type, "| de:", data.from_device_id);

    if (data.type === "answer" && peerConnection && !isAnswered) {
      try {
        // Apprend le device_id du correspondant depuis le signal answer.
        // C'est lui qui recevra les candidates et le bye.
        if (data.from_device_id) {
          targetDeviceId = data.from_device_id;
          console.log("[call] 🎯 Device du correspondant appris:", targetDeviceId);
        }
        const sdpPayload = data.payload?.sdp;
        const sdpStr = typeof sdpPayload === "string" ? sdpPayload : (sdpPayload?.sdp || "");
        if (!sdpStr) {
          console.error("[call] ❌ Answer SDP vide ! Signal:", data);
          return;
        }
        const answer = new RTCSessionDescription({
          type: "answer",
          sdp: sdpNormalise(sdpStr),
        });
        await peerConnection.setRemoteDescription(answer);
        isAnswered = true;
        stopRingback();
        console.log("[call] ✅ Réponse SDP appliquée (longueur:", sdpStr.length, "caractères).");

        // Dépiler les ICE candidates en attente
        while (pendingRemoteCandidates.length > 0) {
          const c = pendingRemoteCandidates.shift();
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(c));
          } catch (_) {}
        }
      } catch (err) {
        console.error("[call] Erreur application Answer SDP:", err);
      }

    } else if (data.type === "candidate" && peerConnection) {
      const cand = data.payload?.candidate;
      if (!cand) return;
      if (isAnswered && peerConnection.remoteDescription) {
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
          console.log("[call] 🧊 Candidat distant ajouté:", cand.type || "?");
        } catch (e) {
          console.warn("[call] ⚠️ Candidat distant rejeté:", e.message);
        }
      } else {
        console.log("[call] 🧊 Candidat distant mis en attente (answer pas encore appliquée).");
        pendingRemoteCandidates.push(cand);
      }
    } else if (data.type === "bye") {
      console.log("[call] 📴 Le correspondant a raccroché.");
      byeSignalSent = true;
      endCall("Appel terminé.");
    }
  });
}

// ---- Timer & Fin d'appel ----

function toggleCamera() {
  if (!localStream) return;
  cameraOn = !cameraOn;
  localStream.getVideoTracks().forEach((t) => {
    t.enabled = cameraOn;
  });
  const btn = camBtn();
  if (btn) {
    btn.classList.toggle("off", !cameraOn);
    btn.setAttribute("aria-label", cameraOn ? "Couper la caméra" : "Activer la caméra");
  }
}

function startTimer() {
  if (callTimer) return;
  callSeconds = 0;
  callTimer = setInterval(() => {
    callSeconds++;
    const m = Math.floor(callSeconds / 60);
    const s = String(callSeconds % 60).padStart(2, "0");
    if (timerEl()) timerEl().textContent = `${m}:${s}`;
  }, 1000);
}

function endCall(message) {
  // Garde-fou : endCall peut être déclenché plusieurs fois (bouton raccrocher
  // + onconnectionstatechange "closed" après peerConnection.close()). On ne
  // fait le nettoyage et la navigation qu'une seule fois.
  if (ended) return;
  ended = true;
  stopRingback();
  if (!byeSignalSent && (targetDeviceId || targetUserId)) {
    sendSignal("bye", {});
    byeSignalSent = true;
  }
  if (callTimer) clearInterval(callTimer);
  callTimer = null;
  if (peerConnection) {
    try { peerConnection.close(); } catch (_) {}
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  const remoteAudio = document.getElementById("remote-audio");
  if (remoteAudio) {
    remoteAudio.pause();
    remoteAudio.remove();
  }
  // Nettoyer les éléments vidéo
  const localVideo = localVideoEl();
  if (localVideo) {
    localVideo.srcObject = null;
    localVideo.style.display = "none";
  }
  const remoteVideo = remoteVideoEl();
  if (remoteVideo) {
    remoteVideo.srcObject = null;
    remoteVideo.style.display = "none";
  }
  document.body.classList.remove("video-mode");
  showStatus(message || "Appel terminé.");
  setTimeout(() => {
    window.location.href = "contacts.html";
  }, 1500);
}
