    // Call Actions

    // ── Wake Lock (garder l'écran allumé pendant la sonnerie et l'appel) ──
    // L'API Wake Lock empêche l'écran de s'éteindre. Elle est automatiquement
    // relâchée quand l'onglet passe en arrière-plan : on la ré-acquiert au
    // retour (visibilitychange). Sans elle, l'écran s'éteint pendant la
    // sonnerie et l'utilisateur ne voit pas l'appel entrant.
    let wakeLock = null;

    // ── ICE Candidate Batching (regroupe les candidats sur 150 ms) ─────
    // Au lieu d'envoyer 1 HTTP POST par candidat ICE (10-30 par appel),
    // on bufferise sur 150 ms et on envoie un seul message batch. C'est
    // le plus gros gain de latence sur le signaling.
    let iceBuffer = [];
    let iceFlushTimer = null;

    // ── Appel facturé (module patient/médecin) ────────────────────────
    let currentAppelId = null;    // ID de l'appel dans la table `appels`
    let heartbeatInterval = null; // timer du heartbeat (10 s pendant l'appel)
    let heartbeat409Count = 0;    // 409 consécutifs du heartbeat → appel terminé

    async function acquireWakeLock() {
      if (!("wakeLock" in navigator)) return; // navigateur non supporté
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
        console.log("[YAM] 💡 Wake Lock acquis (écran maintenu allumé)");
      } catch (err) {
        console.warn("[YAM] Wake Lock indisponible:", err.name || err);
      }
    }

    async function releaseWakeLock() {
      if (wakeLock) {
        try { await wakeLock.release(); } catch (_) {}
        wakeLock = null;
      }
    }

    // Envoie le buffer de candidats ICE au serveur en un seul message.
    // Appelé après un flush timer (150 ms) ou au moment de l'answer.
    function flushIceBuffer() {
      if (iceBuffer.length === 0) return;
      clearTimeout(iceFlushTimer);
      iceFlushTimer = null;
      const batch = iceBuffer.splice(0);
      sendSignal("candidates_batch", { candidates: batch });
    }

    // Ré-acquiert le wake lock quand l'onglet redevient visible (il est
    // relâché automatiquement par le navigateur quand l'onglet est caché).
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && (activeOverlay.classList.contains("active") || incomingOverlay.classList.contains("active"))) {
        acquireWakeLock();
      }
    });

    // ── Permissions micro/caméra (demande proactive) ──
    // Le navigateur n'affiche la demande de permission qu'après un geste
    // utilisateur. On la déclenche au premier clic/toucher pour que les
    // appels suivants (sortants ET entrants) trouvent le micro/caméra déjà
    // autorisés — sinon getUserMedia échoue (NotFoundError/NotAllowedError)
    // et l'appel est tué immédiatement au décrochage.
    let mediaPermissionGranted = false;
    async function requestMediaPermissions() {
      if (mediaPermissionGranted) return;
      if (!navigator.mediaDevices?.getUserMedia) return;
      try {
        // Demande combinée (un seul prompt) : micro + caméra.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        // Permission accordée : on libère immédiatement les devices pour ne
        // pas garder le micro/caméra allumés (led caméra éteinte).
        stream.getTracks().forEach(t => t.stop());
        mediaPermissionGranted = true;
        console.log("[YAM] ✅ Permissions micro + caméra accordées");
      } catch (err) {
        // La caméra peut manquer : retente en audio seul pour au moins
        // autoriser le micro.
        console.warn("[YAM] Permission micro+caméra refusée:", err.name || err);
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
          mediaPermissionGranted = true;
          console.log("[YAM] ✅ Permission micro accordée (caméra indisponible)");
        } catch (err2) {
          console.warn("[YAM] Permission micro refusée:", err2.name || err2);
        }
      }
    }
    // Au chargement : ré-acquiert la permission si déjà accordée lors d'une
    // session précédente (aucun geste requis dans ce cas).
    requestMediaPermissions();
    // Premier geste utilisateur : déclenche la demande si elle n'a pas
    // abouti (le navigateur n'affiche le prompt qu'après un geste).
    document.addEventListener("click", () => requestMediaPermissions(), { once: true });
    document.addEventListener("touchstart", () => requestMediaPermissions(), { once: true });

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
      currentAppelId = null;
      heartbeat409Count = 0;

      // 1. CRÉER L'APPEL FACTURÉ (POST /v1/appels/init).
      // Le serveur vérifie le solde (402 si solde ≤ 0) et enregistre l'appel
      // en base. Sans appel_id, on ne lance pas l'appel : un patient à
      // découvert ne peut pas appeler.
      try {
        const appelId = await initAppel(clean);
        if (!appelId) return; // solde insuffisant → alert déjà affiché
        currentAppelId = appelId;
        console.log("[YAM] 💰 Appel facturé créé #" + currentAppelId);
      } catch (err) {
        alert("Impossible de créer l'appel : " + err.message);
        return;
      }

      showActiveCallUI("Appel en cours…");
      acquireWakeLock(); // garder l'écran allumé pendant la sonnerie sortante

      // Sonnerie sortante (ringback) — son dédié, différent de la sonnerie
      // d'appel entrant. Le ringback s'arrête quand l'appelé décroche
      // (answer reçu → onCallEstablished) ou quand on raccroche.
      if (ringbackAudio) {
        ringbackAudio.currentTime = 0;
        ringbackAudio.play().catch(() => {});
      }

      // Timeout de sonnerie : si personne ne décroche après 30 s (spec du
      // module facturé), annuler via l'API. hangUp() termine l'appel facturé
      // (raison non_decroche) puis envoie le bye.
      if (ringbackTimeout) clearTimeout(ringbackTimeout);
      ringbackTimeout = setTimeout(() => {
        if (!isAnswered) {
          console.log("[YAM] ⏰ Personne n'a répondu (30 s) — annulation.");
          if (currentAppelId) {
            hangUp(); // termine l'appel facturé (non_decroche) + bye + teardown
          } else {
            cancelCallViaApi();
          }
        }
      }, 30000);

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

        // 2. LANCER LA SONNERIE FACTURÉE (POST /v1/appels/{id}/lancer).
        // Diffuse AppelLance sur le canal privé du destinataire : il reçoit
        // l'appel_id nécessaire au décrochage et au heartbeat. Le ring
        // existant a déjà déclenché la sonnerie (IncomingCall) ; AppelLance
        // apporte l'appel_id (pas de double sonnerie côté destinataire).
        if (currentAppelId) {
          // P1-5 : on ATTEND le résultat. Si lancer échoue définitivement
          // (3 retries), l'appel resterait "initie" côté serveur → jamais
          // facturé + coupure à ~30 s (heartbeat 409×3 → hangUp). On coupe
          // immédiatement avec un message explicite.
          const lanceOk = await lancerAppel(currentAppelId);
          if (!lanceOk) {
            terminerAppel("non_decroche");
            hangUp();
            alert("Impossible de lancer l'appel facturé. Vérifiez votre connexion et réessayez.");
            return;
          }
        }
      } catch (err) {
        console.error("Outgoing call error:", err);
        // Appel facturé orphelin (init réussi mais ring/offer échoué) :
        // le terminer proprement pour ne pas laisser un appel "initie" en base.
        if (currentAppelId) terminerAppel("non_decroche");
        alert("Impossible d'accéder au micro ou de joindre le serveur : " + err.message);
        hangUp();
      }
    }

    function handleIncomingCall(data) {
      if (peerConnection || activeOverlay.classList.contains("active")) return;
      // P2-2 : si l'overlay d'appel entrant est DÉJÀ actif (AppelLance a
      // affiché le mode dégradé avec un device fictif "appel-{id}"), on met
      // à jour les champs avec le vrai device/name SANS rejouer la sonnerie.
      const alreadyActive = incomingOverlay.classList.contains("active");
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

      // Si un appel facturé est déjà actif (AppelLance a stocké currentAppelId
      // avant le ring), on garde l'appel_id : il sera utilisé au décrochage.

      document.getElementById("incoming-caller-name").textContent = currentCallPeerName;
      document.getElementById("incoming-caller-id").textContent = currentCallPeerId;
      document.getElementById("incoming-avatar").textContent = currentCallPeerName.charAt(0).toUpperCase();

      if (alreadyActive) return; // pas de double sonnerie

      incomingOverlay.classList.add("active");
      ringtoneAudio.currentTime = 0;
      ringtoneAudio.play().catch(() => {});
      if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
      acquireWakeLock(); // garder l'écran allumé pendant la sonnerie entrante

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
      // P2-2 : si AppelLance est arrivé avant le ring (mode dégradé), le
      // device est fictif ("appel-{id}"). Attendre que le ring apporte le
      // vrai device (max 5 s) pour que l'answer soit routé correctement.
      if (currentCallPeerId && currentCallPeerId.startsWith("appel-")) {
        await waitForRealDevice(5000);
      }
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

      // Décrocher l'appel facturé côté serveur (POST /v1/appels/{id}/decrocher).
      // Le serveur enregistre date_decroche → le heartbeat côté appelant peut
      // commencer à débiter. On attend jusqu'à 10 s que l'appel_id soit dispo
      // (AppelLance peut arriver quelques ms après IncomingCall selon le réseau).
      if (!currentAppelId) await waitForAppelId(10000);
      if (currentAppelId) decrocherAppel(currentAppelId); // retry interne (P0-1)

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
    //
    // L'offre peut mettre 1 à 3 s à être disponible : l'appelant doit d'abord
    // recevoir le call_id du ring (réponse HTTP), puis envoyer son offre via
    // /call/signal, et le serveur ne stocke l'offre qu'à la fin de ce POST.
    // Un 404 immédiat est donc NORMAL si on accepte très vite — on réessaie
    // avec backoff au lieu d'abandonner (sinon l'appelé raccrocherait avant
    // même que l'offre n'existe).
    async function fetchDeferredOffer() {
      if (!currentCallId || !myDeviceId) {
        console.error("[YAM] Offre différée impossible : call_id ou device_id manquant");
        hangUp();
        return;
      }
      const cleanBase = serverUrl.replace(/\/+$/, "");
      const headers = {};
      const token = authToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const maxAttempts = 10;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await fetch(
            `${cleanBase}/api/v1/call/${encodeURIComponent(currentCallId)}/offer?device_id=${encodeURIComponent(myDeviceId)}`,
            { cache: "no-store", headers: headers }
          );
          if (res.status === 200) {
            const offerData = await res.json();
            console.log("[YAM] ✅ Offre différée récupérée (HTTP 200, essai " + attempt + ")");
            // Le backend stocke le payload tel quel : {sdp: {type, sdp}}.
            const sdpStr = offerData.payload?.sdp?.sdp || offerData.payload?.sdp || "";
            const desc = new RTCSessionDescription({
              type: "offer",
              sdp: sdpNormalise(sdpStr)
            });
            await answerOffer(desc);
            return;
          }
          if (res.status === 403 || res.status === 410) {
            // Erreur définitive : device non autorisé ou offre expirée.
            console.error("[YAM] Offre différée refusée (HTTP " + res.status + ")");
            hangUp();
            return;
          }
          // 404 : l'offre n'est pas encore stockée → réessayer.
          console.log("[YAM] Offre différée pas encore disponible (essai " + attempt + "/" + maxAttempts + ")");
          await new Promise(r => setTimeout(r, 700));
        } catch (err) {
          console.error("[YAM] Erreur récupération offre différée:", err);
          hangUp();
          return;
        }
      }
      console.error("[YAM] Offre différée indisponible après " + maxAttempts + " essais");
      hangUp();
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
      // Terminer l'appel facturé côté serveur (non_decroche) si l'appel
      // a été créé (currentAppelId défini via AppelLance).
      if (currentAppelId) terminerAppel("non_decroche");
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
        // Flush immédiat des candidats bufferisés avant l'answer (ils ne
        // pouvaient pas être routés tant que le peerId était inconnu).
        flushIceBuffer();
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
      } else if (type === "candidates_batch") {
        // Batch de candidats ICE (regroupés côté émetteur sur 150 ms).
        // Traitement identique au type "candidate" unitaire.
        // NB : le serveur dé-batche normalement en candidats unitaires ;
        // ce handler reste en filet de sécurité pour un batch natif.
        const cands = Array.isArray(payload.candidates) ? payload.candidates : [];
        for (const c of cands) {
          if (!c || !c.candidate) continue;
          const cand = new RTCIceCandidate(c);
          if (isAnswered && peerConnection) {
            peerConnection.addIceCandidate(cand).catch(() => {});
          } else {
            pendingCandidates.push(cand);
          }
        }
      } else if (type === "bye") {
        console.log("[YAM] bye reçu → from:", data.from_device_id, "currentCallPeerId:", currentCallPeerId, "currentCallTargetUserId:", currentCallTargetUserId, "isAnswered:", isAnswered, "call_id:", data.call_id);
        const from = data.from_device_id;
        // Multi-appareils : un bye peut venir d'un AUTRE appareil du
        // destinataire qui décline pendant qu'un autre répond. On ignore les
        // bye d'appareils tiers, mais on accepte :
        //  - le bye du device avec lequel on est connecté (currentCallPeerId) ;
        //  - avant l'answer (currentCallPeerId encore inconnu), un bye dont le
        //    call_id correspond à notre appel — aligné sur le mobile. Sans
        //    cette vérification, un refus (reason:reject) avant l'answer est
        //    ignoré et l'appelant continue de sonner jusqu'au timeout.
        if (currentCallPeerId && from && currentCallPeerId !== from) return;
        if (!currentCallPeerId) {
          const byeCallId = data.call_id;
          if (byeCallId && currentCallId && byeCallId !== currentCallId) return;
          if (!currentCallTargetUserId) return;
        }
        const wasInCall = activeOverlay.classList.contains("active");
        logCall(currentCallPeerId || from, currentCallPeerName, !wasInCall, currentCallTargetUserId);
        teardown();
      }
    }

    function createPeerConnection() {
      const pc = new RTCPeerConnection({ iceServers: iceServersConfig });
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        // Bufferise TOUJOURS (fix perte de candidats pré-answer : avant,
        // les candidats générés avant l'answer étaient silencieusement jetés
        // car currentCallPeerId était null — le média mettait très longtemps
        // à s'établir sur NAT symétrique).
        iceBuffer.push(e.candidate.toJSON());
        // Si le peerId est connu, planifie un flush groupé (150 ms).
        // Sinon, on garde en buffer : le flush sera déclenché par l'answer.
        if (currentCallPeerId) {
          clearTimeout(iceFlushTimer);
          iceFlushTimer = setTimeout(flushIceBuffer, 150);
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
        // Défensif : ne devrait pas arriver (le timer n'est armé que si le
        // peerId est connu, et teardown() nettoie le buffer). Un log aide
        // au debug si un flush survient hors contexte d'appel.
        console.warn("[YAM] Signal \"" + type + "\" ignoré : device du correspondant inconnu");
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
          // Log explicite : un signal rejeté (ex. answer → 401/422) échouait
          // silencieusement, laissant croire à un appel établi côté web alors
          // que l'autre partie ne recevait rien.
          const errBody = await res.text().catch(() => "");
          console.error(`[YAM] Signal "${type}" rejeté (HTTP ${res.status}):`, errBody.slice(0, 500));
          if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 500 * attempt));
        } catch (err) {
          console.error("Signal error:", err);
          if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 500 * attempt));
        }
      }
    }

    // Annule un appel en cours via l'API (arrêt gracieux côté serveur).
    // Utilisé par le timeout de sonnerie (45 s) pour remplacer le raccrochage
    // direct : le serveur marque la session comme annulée et notifie les
    // autres appareils du destinataire.
    async function cancelCallViaApi() {
      if (!currentCallId || !myDeviceId) {
        console.error("[YAM] Annulation impossible : call_id ou device_id manquant");
        return;
      }
      try {
        const cleanBase = serverUrl.replace(/\/+$/, "");
        const headers = { "Content-Type": "application/json" };
        const token = authToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${cleanBase}/api/v1/call/cancel`, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            call_id: currentCallId,
            from_device_id: myDeviceId
          })
        });
        if (res.ok) {
          console.log("[YAM] ✅ Appel annulé via API");
          // Notifier les autres appareils
          sendSignal("bye", { reason: "cancel" });
          hangUp();
        } else {
          console.error("[YAM] Échec annulation appel :", await res.text());
        }
      } catch (err) {
        console.error("[YAM] Erreur annulation appel :", err);
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
      // L'appel est établi : le heartbeat de facturation démarre (10 s).
      // Côté appelant patient, le serveur débite le solde en continu et
      // répond { continuer: false } à épuisement total → coupure.
      startHeartbeat();
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
      // Terminer l'appel facturé côté serveur : raccroche_manuel si l'appel
      // était établi, non_decroche sinon (personne n'a répondu / refus).
      if (currentAppelId) {
        terminerAppel(callStartTime ? "raccroche_manuel" : "non_decroche");
      }
      if (currentCallPeerId || currentCallTargetUserId) {
        sendSignal("bye", callStartTime ? {} : { reason: "cancel" });
        logCall(currentCallPeerId, currentCallPeerName, !callStartTime, currentCallTargetUserId);
      }
      teardown();
    }

    function teardown() {
      stopTitleBlink();
      stopHeartbeat(); // arrête le battement de facturation
      currentAppelId = null;
      heartbeat409Count = 0;
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
      releaseWakeLock(); // l'appel est terminé : l'écran peut se rendormir
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
      clearTimeout(iceFlushTimer);
      iceFlushTimer = null;
      iceBuffer = [];
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

    // ══════════════════════════════════════════════════════════════════
    // MODULE APPELS FACTURÉS (patient / médecin / solde)
    // ══════════════════════════════════════════════════════════════════

    // ── Réception d'AppelLance (canal privé user.{id}) ────────────────
    // L'appelant a appelé POST /v1/appels/{id}/lancer : le serveur diffuse
    // cet événement sur le canal PRIVÉ du destinataire avec l'appel_id.
    // Le destinataire en a besoin pour decrocher et heartbeat.
    function handleAppelLance(data) {
      const appelId = data && data.appel_id;
      if (!appelId) return;
      currentAppelId = appelId;
      console.log("[YAM] 💰 Appel facturé #" + currentAppelId + " sonne (initié par " + (data.initie_par || "?") + ")");
      // Si l'overlay d'appel entrant est déjà affiché (IncomingCall du ring
      // reçu avant AppelLance), on ne fait que mémoriser l'appel_id : pas de
      // double overlay. Sinon (AppelLance arrivé en premier), on affiche un
      // appel entrant en mode dégradé — le ring qui suit le complètera.
      if (incomingOverlay.classList.contains("active")) return;
      if (peerConnection || activeOverlay.classList.contains("active")) return;
      handleIncomingCall({
        call_id: null,
        from_device_id: "appel-" + currentAppelId,
        from_username: "Appel entrant",
        from_user_id: null,
        type: "audio",
      });
    }

    // ── POST /v1/appels/init ──────────────────────────────────────────
    // Crée l'appel facturé. Retourne l'appel_id, ou null si solde insuffisant
    // (402 → alert). Lève une erreur pour tout autre échec.
    async function initAppel(destinationUserId) {
      const cleanBase = serverUrl.replace(/\/+$/, "");
      const fetchFn = window.fetchAuth || fetch; // wrapper auth (Bearer + 401)
      const res = await fetchFn(cleanBase + "/api/v1/appels/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination_user_id: destinationUserId })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) {
        alert("Solde insuffisant pour initier un appel.");
        return null;
      }
      if (!res.ok) {
        // P2-6 : le serveur peut renvoyer { error: { message } } (403/409)
        // ou { errors: { champ: [...] } } (422) — on extrait le premier message.
        const msg = data.error?.message
          || (data.errors ? Object.values(data.errors)[0]?.[0] : null)
          || "Échec de l'init (HTTP " + res.status + ")";
        throw new Error(msg);
      }
      // P2-9 : un 201 sans appel_id est un bug serveur → erreur explicite
      // plutôt qu'un appel_id undefined qui planterait plus tard.
      const appelId = data.data?.appel_id;
      if (!appelId) throw new Error("Le serveur n'a pas retourné d'identifiant d'appel.");
      return appelId;
    }

    // ── POST /v1/appels/{id}/lancer ───────────────────────────────────
    // Passe l'appel au statut "sonne" et diffuse AppelLance au destinataire.
    async function lancerAppel(appelId) {
      const cleanBase = serverUrl.replace(/\/+$/, "");
      const fetchFn = window.fetchAuth || fetch;
      // P0-1 : si le réseau est instable, on réessaie (3 tentatives espacées
      // de 500 ms) plutôt que de laisser l'appel non facturé.
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetchFn(cleanBase + "/api/v1/appels/" + appelId + "/lancer", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          if (res.ok) return true;
          console.warn("[YAM] lancer échoué (HTTP " + res.status + "), essai " + attempt + "/3");
        } catch (err) {
          console.warn("[YAM] lancer erreur réseau (essai " + attempt + "/3):", err);
        }
        if (attempt < 3) await new Promise(r => setTimeout(r, 500));
      }
      return false; // échec définitif après 3 tentatives
    }

    // ── POST /v1/appels/{id}/decrocher ────────────────────────────────
    // Marque l'appel "decroche" + date_decroche côté serveur. C'est le point
    // de départ du calcul de facturation (heartbeat).
    async function decrocherAppel(appelId) {
      const cleanBase = serverUrl.replace(/\/+$/, "");
      const fetchFn = window.fetchAuth || fetch;
      // P0-1 : même retry que lancer. Si decrocher échoue définitivement,
      // le heartbeat serveur auto-décrochera l'appel (date_decroche = now),
      // donc la facturation démarre quand même.
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetchFn(cleanBase + "/api/v1/appels/" + appelId + "/decrocher", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
          });
          if (res.ok) return;
          console.warn("[YAM] decrocher échoué (HTTP " + res.status + "), essai " + attempt + "/3");
        } catch (err) {
          console.warn("[YAM] decrocher erreur réseau (essai " + attempt + "/3):", err);
        }
        if (attempt < 3) await new Promise(r => setTimeout(r, 500));
      }
    }

    // ── POST /v1/appels/{id}/terminer ─────────────────────────────────
    // Termine l'appel : raccroche_manuel (appel établi) ou non_decroche
    // (personne n'a répondu / refus). Silencieux : un appel déjà terminé
    // renvoie 409, ce qui est normal (l'autre partie a raccroché).
    async function terminerAppel(raison) {
      if (!currentAppelId) return;
      try {
        const cleanBase = serverUrl.replace(/\/+$/, "");
        const fetchFn = window.fetchAuth || fetch;
        const res = await fetchFn(cleanBase + "/api/v1/appels/" + currentAppelId + "/terminer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raison: raison })
        });
        if (!res.ok) {
          console.log("[YAM] terminer ignoré (HTTP " + res.status + ") — appel déjà terminé ?");
        }
      } catch (err) {
        console.warn("[YAM] terminer erreur:", err);
      }
    }

    // ── Attente de l'appel_id (AppelLance peut arriver après IncomingCall) ──
    function waitForAppelId(timeoutMs) {
      if (currentAppelId) return Promise.resolve(currentAppelId);
      return new Promise(resolve => {
        const start = Date.now();
        const timer = setInterval(() => {
          if (currentAppelId || Date.now() - start > timeoutMs) {
            clearInterval(timer);
            resolve(currentAppelId);
          }
        }, 150);
      });
    }

    // ── Attente du vrai device (P2-2) ────────────────────────────────────
    // En mode dégradé (AppelLance reçu avant le ring), currentCallPeerId vaut
    // "appel-{id}" (fictif). On attend que le ring apporte le vrai device
    // (ou que le timeout expire) avant d'envoyer l'answer.
    function waitForRealDevice(timeoutMs) {
      return new Promise(resolve => {
        const start = Date.now();
        const timer = setInterval(() => {
          const real = currentCallPeerId && !currentCallPeerId.startsWith("appel-");
          if (real || Date.now() - start > timeoutMs) {
            clearInterval(timer);
            resolve();
          }
        }, 150);
      });
    }

    // ── Heartbeat de facturation (10 s) ────────────────────────────────
    // Pendant un appel décroché, chaque participant envoie un battement.
    // Le serveur recalcule le coût depuis date_decroche et débite le solde
    // du patient (si c'est le patient qui a initié). À solde = 0, il répond
    // { continuer: false } → coupure immédiate de l'appel.
    function startHeartbeat() {
      if (!currentAppelId || heartbeatInterval) return;
      heartbeatInterval = setInterval(sendHeartbeat, 10000);
      sendHeartbeat(); // premier battement immédiat
    }

    function stopHeartbeat() {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    }

    async function sendHeartbeat() {
      if (!currentAppelId) return;
      try {
        const cleanBase = serverUrl.replace(/\/+$/, "");
        const fetchFn = window.fetchAuth || fetch;
        const res = await fetchFn(cleanBase + "/api/v1/appels/" + currentAppelId + "/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });
        if (res.status === 409) {
          // Appel pas encore "decroche" côté serveur, OU déjà terminé.
          // Avec l'auto-décrochage serveur, un 409 répété (3×) signifie que
          // l'appel est terminé → on raccroche pour ne pas boucler.
          heartbeat409Count++;
          if (heartbeat409Count >= 3) {
            console.warn("[YAM] heartbeat 409 répété — appel terminé, raccrochage.");
            hangUp();
          }
          return;
        }
        heartbeat409Count = 0;
        if (!res.ok) {
          console.warn("[YAM] heartbeat échoué (HTTP " + res.status + "):", await res.text());
          return;
        }
        const data = await res.json();
        const d = data.data || {};
        if (d.continuer === false) {
          console.log("[YAM] ⛔ Solde épuisé — coupure de l'appel.");
          alert("Votre solde est épuisé. L'appel est terminé.");
          hangUp();
        } else if (d.solde_restant != null) {
          // P2-1 : affiche le solde restant dans l'overlay d'appel actif.
          const el = document.getElementById("active-call-solde");
          if (el) {
            el.textContent = "Solde : " + d.solde_restant + " F";
            el.style.display = "block";
          }
        }
      } catch (err) {
        console.warn("[YAM] heartbeat erreur:", err);
      }
    }

    // ── GET /v1/patients/{id}/solde ───────────────────────────────────
    // Affiche la carte "Mon solde" dans l'onglet Accueil (patients uniquement).
    async function refreshSolde() {
      const role = localStorage.getItem("user_role");
      const uid = localStorage.getItem("user_id");
      const card = document.getElementById("solde-card");
      if (!card) return;
      if (role !== "patient" || !uid) {
        card.style.display = "none";
        return;
      }
      try {
        const cleanBase = serverUrl.replace(/\/+$/, "");
        const fetchFn = window.fetchAuth || fetch;
        const res = await fetchFn(cleanBase + "/api/v1/patients/" + uid + "/solde");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const solde = data.data?.solde;
        card.style.display = "flex";
        const el = document.getElementById("solde-amount");
        if (el) el.textContent = (solde != null ? solde : "—") + " F";
      } catch (err) {
        console.warn("[YAM] Solde indisponible:", err);
      }
    }

