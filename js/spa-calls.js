    // Call Actions
    async function startOutgoingCall(targetUserId, targetName, video) {
      const clean = (targetUserId || "").trim();
      if (!clean) return;
      // Le device du correspondant est appris au premier signal answer.
      currentCallPeerId = null;
      currentCallTargetUserId = clean;
      currentCallPeerName = targetName || clean;
      currentCallType = video ? "video" : "audio";
      isCameraOn = currentCallType === "video";
      isAnswered = false;
      isAcceptRequested = false;
      pendingOffer = null;
      pendingCandidates = [];

      showActiveCallUI("Appel en cours…");

      // Sonnerie sortante (ringback) — son dédié, différent de la sonnerie
      // d'appel entrant. Le ringback s'arrête quand l'appelé décroche
      // (answer reçu → onCallEstablished) ou quand on raccroche.
      if (ringbackAudio) {
        ringbackAudio.currentTime = 0;
        ringbackAudio.play().catch(() => {});
      }

      // Timeout de sonnerie : si personne ne décroche après 45 s, raccrocher
      // (évite de sonner indéfiniment si le destinataire ne répond pas).
      if (ringbackTimeout) clearTimeout(ringbackTimeout);
      ringbackTimeout = setTimeout(() => {
        if (!isAnswered) {
          console.log("[YAM] ⏰ Personne n'a répondu (45 s) — raccrochage.");
          hangUp();
        }
      }, 45000);

      try {
        const cleanBase = serverUrl.replace(/\/+$/, "");
        const ringHeaders = { "Content-Type": "application/json" };
        const ringToken = authToken();
        if (ringToken) ringHeaders["Authorization"] = `Bearer ${ringToken}`;
        const ringRes = await fetch(cleanBase + "/api/v1/call/ring", {
          method: "POST",
          headers: ringHeaders,
          body: JSON.stringify({
            to_user_id: currentCallTargetUserId,
            from_device_id: myDeviceId,
            from_username: myUserName,
            type: currentCallType
          })
        });
        // Récupère le call_id pour le stockage différé de l'offre côté serveur.
        const ringData = await ringRes.json().catch(() => ({}));
        if (!ringRes.ok) {
          throw new Error(ringData.error?.message || "Échec de la sonnerie (HTTP " + ringRes.status + ")");
        }
        currentCallId = ringData.data?.call_id || ringData.call_id || null;
        console.log("[YAM] 📞 call_id:", currentCallId);

        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: currentCallType === "video",
        });
        peerConnection = createPeerConnection();
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
        if (currentCallType === "video") showLocalVideo();

        const offer = await peerConnection.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: currentCallType === "video",
        });
        await peerConnection.setLocalDescription(offer);

        await sendSignal("offer", {
          sdp: { type: offer.type, sdp: sdpNormalise(offer.sdp) }
        });
      } catch (err) {
        console.error("Outgoing call error:", err);
        alert("Impossible d'accéder au micro ou de joindre le serveur : " + err.message);
        hangUp();
      }
    }

    function handleIncomingCall(data) {
      if (peerConnection || activeOverlay.classList.contains("active")) return;
      currentCallPeerId = data.from_device_id;
      currentCallPeerName = data.from_username || data.from_device_id || "Inconnu";
      currentCallTargetUserId = data.from_user_id != null ? String(data.from_user_id) : null;
      currentCallId = data.call_id || null;
      currentCallType = data.type === "video" ? "video" : "audio";
      isCameraOn = currentCallType === "video";
      pendingOffer = null;
      isAcceptRequested = false;
      isAnswered = false;
      pendingCandidates = [];

      document.getElementById("incoming-caller-name").textContent = currentCallPeerName;
      document.getElementById("incoming-caller-id").textContent = currentCallPeerId;
      document.getElementById("incoming-avatar").textContent = currentCallPeerName.charAt(0).toUpperCase();

      incomingOverlay.classList.add("active");
      ringtoneAudio.currentTime = 0;
      ringtoneAudio.play().catch(() => {});
      if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);

      startTitleBlink(currentCallPeerName);

      // Notification bureau si l'onglet est en arrière-plan
      if (document.hidden && "Notification" in window && Notification.permission === "granted") {
        try {
          const n = new Notification("📞 Appel entrant Yam", {
            body: currentCallPeerName + " vous appelle...",
            requireInteraction: true,
            tag: "yam-incoming-call"
          });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        } catch (_) {}
      }
    }

    async function acceptIncomingCall() {
      // Garde-fou anti double-clic : deux acceptIncomingCall() concurrents
      // feraient un double setRemoteDescription → appel tué.
      if (isAcceptRequested) return;
      ringtoneAudio.pause();
      ringtoneAudio.currentTime = 0;
      if (ringbackAudio) {
        ringbackAudio.pause();
        ringbackAudio.currentTime = 0;
      }
      stopTitleBlink();
      if (navigator.vibrate) navigator.vibrate(0);
      incomingOverlay.classList.remove("active");
      isAcceptRequested = true;
      showActiveCallUI("Connexion…");

      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: currentCallType === "video",
        });
        peerConnection = createPeerConnection();
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
        if (currentCallType === "video") showLocalVideo();

        if (pendingOffer) {
          await answerOffer(pendingOffer);
        } else {
          // Offre non reçue en temps réel (appelé hors ligne / reconnexion) :
          // la récupérer depuis le stockage différé du serveur.
          await fetchDeferredOffer();
        }
      } catch (err) {
        console.error("Accept error:", err);
        refuseIncomingCall();
      }
    }

    // Récupère l'offre SDP différée (GET /call/{id}/offer) quand elle n'a pas
    // été reçue en temps réel pendant la sonnerie.
    async function fetchDeferredOffer() {
      if (!currentCallId || !myDeviceId) {
        console.error("[YAM] Offre différée impossible : call_id ou device_id manquant");
        hangUp();
        return;
      }
      try {
        const cleanBase = serverUrl.replace(/\/+$/, "");
        const headers = {};
        const token = authToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(
          `${cleanBase}/api/v1/call/${encodeURIComponent(currentCallId)}/offer?device_id=${encodeURIComponent(myDeviceId)}`,
          { cache: "no-store", headers: headers }
        );
        if (res.status === 200) {
          const offerData = await res.json();
          console.log("[YAM] ✅ Offre différée récupérée (HTTP 200)");
          // Le backend stocke le payload tel quel : {sdp: {type, sdp}}.
          const sdpStr = offerData.payload?.sdp?.sdp || offerData.payload?.sdp || "";
          const desc = new RTCSessionDescription({
            type: "offer",
            sdp: sdpNormalise(sdpStr)
          });
          await answerOffer(desc);
        } else {
          console.error("[YAM] Offre différée indisponible (HTTP " + res.status + ")");
          hangUp();
        }
      } catch (err) {
        console.error("[YAM] Erreur récupération offre différée:", err);
        hangUp();
      }
    }

    async function answerOffer(offerDesc) {
      if (!peerConnection || isAnswered) return;
      await peerConnection.setRemoteDescription(offerDesc);
      drainPendingCandidates();
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      await sendSignal("answer", {
        sdp: { type: answer.type, sdp: sdpNormalise(answer.sdp) }
      });
      isAnswered = true;
      onCallEstablished();
    }

    function refuseIncomingCall() {
      ringtoneAudio.pause();
      ringtoneAudio.currentTime = 0;
      stopTitleBlink();
      if (navigator.vibrate) navigator.vibrate(0);
      incomingOverlay.classList.remove("active");
      // Aligné sur hangUp() : envoie le bye même si le device du correspondant
      // est inconnu (sendSignal route alors par user).
      if (currentCallPeerId || currentCallTargetUserId) {
        sendSignal("bye", { reason: "reject" });
        logCall(currentCallPeerId, currentCallPeerName, true, currentCallTargetUserId);
      }
      teardown();
    }

    async function handleCallSignal(data) {
      if (data.from_device_id === myDeviceId) return;
      const type = data.type;
      const payload = data.payload || {};

      if (type === "offer") {
        if (!payload.sdp) return;
        const desc = new RTCSessionDescription({
          type: "offer",
          sdp: sdpNormalise(payload.sdp.sdp)
        });
        if (isAcceptRequested && !isAnswered && peerConnection) {
          await answerOffer(desc);
        } else {
          pendingOffer = desc;
        }
      } else if (type === "answer") {
        // Garde-fou anti-double-answer : un second setRemoteDescription
        // échouerait et tuerait l'appel (envois répétés côté appelant).
        if (!peerConnection || !payload.sdp || isAnswered) return;
        // Apprend le device de l'appelé pour router les candidates et le bye.
        currentCallPeerId = data.from_device_id;
        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription({
            type: "answer",
            sdp: sdpNormalise(payload.sdp.sdp)
          }));
          isAnswered = true;
          drainPendingCandidates();
          onCallEstablished();
        } catch (e) {
          console.error("Answer error:", e);
        }
      } else if (type === "candidate") {
        const c = payload.candidate;
        if (!c || !c.candidate) return;
        const cand = new RTCIceCandidate(c);
        if (isAnswered && peerConnection) {
          peerConnection.addIceCandidate(cand).catch(() => {});
        } else {
          pendingCandidates.push(cand);
        }
      } else if (type === "bye") {
        console.log("[YAM] bye reçu → from:", data.from_device_id, "currentCallPeerId:", currentCallPeerId, "currentCallTargetUserId:", currentCallTargetUserId, "isAnswered:", isAnswered);
        const from = data.from_device_id;
        // Multi-appareils : tant qu'aucun answer n'a été reçu (isAnswered
        // false), un bye peut venir d'un AUTRE appareil du destinataire qui
        // décline pendant qu'un autre répond. On l'ignore pour ne pas tuer
        // l'appel en cours d'établissement. Seul un bye du device avec
        // lequel on est connecté (ou un bye sans device, legacy) coupe.
        if (!isAnswered) {
          // Multi-appareils : tant qu'aucun answer n'a été reçu, un bye peut
          // venir d'un AUTRE appareil du destinataire qui décline pendant
          // qu'un autre répond. On ignore ces bye d'appareils tiers, mais on
          // accepte le bye de l'appelant (currentCallPeerId) qui a raccroché.
          if (from && from !== currentCallPeerId) return;
          if (!currentCallPeerId && !currentCallTargetUserId) return;
        } else if (currentCallPeerId && from && currentCallPeerId !== from) {
          return; // bye d'un device tiers pendant l'appel → ignorer
        }
        const wasInCall = activeOverlay.classList.contains("active");
        logCall(currentCallPeerId || from, currentCallPeerName, !wasInCall, currentCallTargetUserId);
        teardown();
      }
    }

    function createPeerConnection() {
      const pc = new RTCPeerConnection({ iceServers: iceServersConfig });
      pc.onicecandidate = (e) => {
        if (e.candidate && currentCallPeerId) {
          sendSignal("candidate", { candidate: e.candidate.toJSON() });
        }
      };
      pc.ontrack = (e) => {
        console.log("[YAM] ontrack → kind:", e.track.kind, "streams:", e.streams?.length, "peerId:", currentCallPeerId);
        if (e.track.kind === "video") {
          const remoteVideo = document.getElementById("remote-video");
          if (remoteVideo) {
            if (e.streams && e.streams[0]) {
              remoteVideo.srcObject = e.streams[0];
            } else {
              remoteVideo.srcObject = new MediaStream([e.track]);
            }
            document.body.classList.add("video-mode");
          }
        } else {
          if (e.streams && e.streams[0]) {
            remoteAudio.srcObject = e.streams[0];
          } else {
            remoteAudio.srcObject = new MediaStream([e.track]);
          }
          remoteAudio.play().catch(() => {});
        }
      };
      pc.onconnectionstatechange = () => {
        console.log("[YAM] connectionState →", pc.connectionState);
        if (pc.connectionState === "connected") {
          onCallEstablished();
        } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          hangUp();
        } else if (pc.connectionState === "disconnected") {
          // Délai de grâce (5 s) : coupures transitoires fréquentes en
          // vidéo (Wi-Fi → 4G, TURN relay, reprise ICE). Un délai trop court
          // (1,5 s) coupait des appels valides juste après le décrochage.
          // On tracke le timer pour pouvoir l'annuler si l'appel se rétablit
          // ou est nettoyé (évite des hangUp() fantômes empilés).
          if (disconnectGraceTimeout) clearTimeout(disconnectGraceTimeout);
          disconnectGraceTimeout = setTimeout(() => {
            disconnectGraceTimeout = null;
            if (peerConnection === pc && pc.connectionState === "disconnected") {
              hangUp();
            }
          }, 5000);
        }
      };
      return pc;
    }

    function drainPendingCandidates() {
      if (!peerConnection) return;
      while (pendingCandidates.length > 0) {
        const c = pendingCandidates.shift();
        peerConnection.addIceCandidate(c).catch(() => {});
      }
    }

    async function sendSignal(type, payload) {
      const cleanBase = serverUrl.replace(/\/+$/, "");
      const body = {
        from_device_id: myDeviceId,
        type: type,
        payload: payload
      };
      // L'offre est routée par user (le device du correspondant est encore inconnu) ;
      // les signaux suivants (answer/candidate/hangup) sont routés par device.
      // Pour un bye, si le device du correspondant est encore inconnu (appelant
      // qui raccroche avant l'answer), on route par user pour atteindre tous
      // ses appareils et arrêter la sonnerie.
      if (type === "offer") {
        if (!currentCallTargetUserId) return;
        body.to_user_id = currentCallTargetUserId;
      } else if (type === "bye") {
        if (currentCallPeerId) body.to_device_id = currentCallPeerId;
        if (currentCallTargetUserId) body.to_user_id = currentCallTargetUserId;
      } else if (currentCallPeerId) {
        body.to_device_id = currentCallPeerId;
      } else {
        return;
      }
      // Associe le call_id (stockage différé de l'offre + invalidation au bye).
      if (currentCallId) body.call_id = currentCallId;
      const headers = { "Content-Type": "application/json" };
      const token = authToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;

      // Le bye est critique : si le serveur est injoignable au moment du
      // raccrochage, le correspondant continuerait de sonner jusqu'au timeout.
      // On retente jusqu'à 3 fois avec un petit délai.
      const maxAttempts = type === "bye" ? 3 : 1;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await fetch(cleanBase + "/api/v1/call/signal", {
            method: "POST",
            headers: headers,
            body: JSON.stringify(body)
          });
          if (res.ok) return;
          if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 500 * attempt));
        } catch (err) {
          console.error("Signal error:", err);
          if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 500 * attempt));
        }
      }
    }

    function showActiveCallUI(statusText) {
      document.getElementById("active-call-status-label").textContent = statusText;
      document.getElementById("active-peer-name").textContent = currentCallPeerName;
      document.getElementById("active-peer-id").textContent = currentCallPeerId;
      document.getElementById("active-avatar").textContent = currentCallPeerName.charAt(0).toUpperCase();
      document.getElementById("active-call-timer").textContent = "00:00";
      activeOverlay.classList.add("active");
      const camBtn = document.getElementById("btn-toggle-camera");
      if (camBtn) camBtn.style.display = currentCallType === "video" ? "flex" : "none";
    }

    function onCallEstablished() {
      if (ringbackTimeout) { clearTimeout(ringbackTimeout); ringbackTimeout = null; }
      if (disconnectGraceTimeout) { clearTimeout(disconnectGraceTimeout); disconnectGraceTimeout = null; }
      ringtoneAudio.pause();
      ringtoneAudio.currentTime = 0;
      if (ringbackAudio) {
        ringbackAudio.pause();
        ringbackAudio.currentTime = 0;
      }
      stopTitleBlink();
      document.getElementById("active-call-status-label").textContent = "En Communication";
      if (!callStartTime) {
        callStartTime = Date.now();
        if (callTimerInterval) clearInterval(callTimerInterval);
        callTimerInterval = setInterval(() => {
          const s = Math.floor((Date.now() - callStartTime) / 1000);
          const mm = String(Math.floor(s / 60)).padStart(2, "0");
          const ss = String(s % 60).padStart(2, "0");
          document.getElementById("active-call-timer").textContent = `${mm}:${ss}`;
        }, 1000);
      }
    }

    function hangUp() {
      if (currentCallPeerId || currentCallTargetUserId) {
        sendSignal("bye", callStartTime ? {} : { reason: "cancel" });
        logCall(currentCallPeerId, currentCallPeerName, !callStartTime, currentCallTargetUserId);
      }
      teardown();
    }

    function teardown() {
      stopTitleBlink();
      if (ringbackTimeout) { clearTimeout(ringbackTimeout); ringbackTimeout = null; }
      if (disconnectGraceTimeout) { clearTimeout(disconnectGraceTimeout); disconnectGraceTimeout = null; }
      if (callTimerInterval) clearInterval(callTimerInterval);
      callTimerInterval = null;
      callStartTime = null;
      ringtoneAudio.pause();
      ringtoneAudio.currentTime = 0;
      if (ringbackAudio) {
        ringbackAudio.pause();
        ringbackAudio.currentTime = 0;
      }
      if (navigator.vibrate) navigator.vibrate(0);
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
      }
      pendingOffer = null;
      pendingCandidates = [];
      isAcceptRequested = false;
      isAnswered = false;
      isMicMuted = false;
      isCameraOn = false;
      currentCallType = "audio";
      currentCallPeerId = null;
      currentCallPeerName = null;
      currentCallId = null;
      incomingOverlay.classList.remove("active");
      activeOverlay.classList.remove("active");
      const btnMute = document.getElementById("btn-toggle-mute");
      btnMute.classList.remove("muted");
      // Nettoyer les vidéos
      const localVideo = document.getElementById("local-video");
      if (localVideo) { localVideo.srcObject = null; localVideo.style.display = "none"; }
      const remoteVideo = document.getElementById("remote-video");
      if (remoteVideo) { remoteVideo.srcObject = null; remoteVideo.style.display = "none"; }
      document.body.classList.remove("video-mode");
    }

    function showLocalVideo() {
      const localVideo = document.getElementById("local-video");
      if (localVideo && localStream) {
        localVideo.srcObject = localStream;
        localVideo.style.display = "block";
      }
    }

    function toggleCamera() {
      if (!localStream) return;
      isCameraOn = !isCameraOn;
      localStream.getVideoTracks().forEach(t => t.enabled = isCameraOn);
      const btn = document.getElementById("btn-toggle-camera");
      if (btn) {
        btn.classList.toggle("muted", !isCameraOn);
        btn.setAttribute("aria-label", isCameraOn ? "Couper la caméra" : "Activer la caméra");
        btn.setAttribute("title", isCameraOn ? "Couper la caméra" : "Activer la caméra");
      }
    }

    function toggleMute() {
      if (!localStream) return;
      isMicMuted = !isMicMuted;
      localStream.getAudioTracks().forEach(t => t.enabled = !isMicMuted);
      const btn = document.getElementById("btn-toggle-mute");
      btn.classList.toggle("muted", isMicMuted);
    }

    // ── Message du Service Worker (clic sur notification push) ──────────
    // Quand l'utilisateur clique sur la notification d'appel entrant alors
    // que le SPA est déjà ouvert (en arrière-plan), le Service Worker focus
    // la fenêtre et poste un message YAM_INCOMING_CALL. On le transforme en
    // appel entrant classique (overlay + sonnerie).
    navigator.serviceWorker?.addEventListener("message", (event) => {
      const msg = event.data;
      if (!msg || msg.type !== "YAM_INCOMING_CALL") return;
      console.log("[YAM] 📥 Appel entrant reçu du Service Worker:", msg);
      handleIncomingCall({
        call_id: msg.call_id,
        from_device_id: msg.from_device_id,
        from_username: msg.from_username,
        from_user_id: msg.from_user_id || null,
        type: msg.call_type || "audio",
      });
    });

    // ── Appel entrant via URL (nouvelle fenêtre ouverte depuis une
    // notification push) ────────────────────────────────────────────────
    // Le Service Worker ouvre /app.html?call_id=...&from_device_id=...
    // quand aucune fenêtre n'était ouverte. On lit ces paramètres au
    // démarrage pour afficher l'appel entrant.
    (function readIncomingCallFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const callId = params.get("call_id");
      if (!callId) return;
      console.log("[YAM] 📥 Appel entrant via URL (notification push):", params.toString());
      handleIncomingCall({
        call_id: callId,
        from_device_id: params.get("from_device_id") || "",
        from_username: params.get("from_username") || "Inconnu",
        from_user_id: params.get("from_user_id") || null,
        type: params.get("call_type") || "audio",
      });
      // Nettoie l'URL pour ne pas re-déclencher au refresh.
      history.replaceState({}, "", window.location.pathname);
    })();

