    // ─────────── Authentification (Sanctum) ───────────
    const authScreen = document.getElementById("auth-screen");
    const loginForm = document.getElementById("auth-login-form");
    const registerForm = document.getElementById("auth-register-form");
    const authErrorEl = document.getElementById("auth-error");

    function getApiBase() {
      return serverUrl.replace(/\/+$/, "") + "/api/v1";
    }

    function authToken() {
      return localStorage.getItem("auth_token");
    }

    function showAuthError(msg) {
      authErrorEl.textContent = msg;
      authErrorEl.classList.add("visible");
    }
    function clearAuthError() {
      authErrorEl.classList.remove("visible");
      authErrorEl.textContent = "";
    }

    function extractAuthError(data) {
      if (!data) return "Une erreur inattendue s'est produite.";
      if (data.errors) {
        const f = Object.keys(data.errors)[0];
        const m = data.errors[f];
        return Array.isArray(m) && m.length ? m[0] : "Erreur de validation.";
      }
      if (data.error?.message) return data.error.message;
      if (data.message) return data.message;
      return "Une erreur inattendue s'est produite.";
    }

    function storeSession(data) {
      const d = data?.data || {};
      // Ne JAMAIS écraser un token existant par une chaîne vide : les réponses
      // comme /users/me ne contiennent pas de token et on perdrait la session.
      if (d.token) localStorage.setItem("auth_token", d.token);
      const user = d.user || {};
      localStorage.setItem("user_id", user.id != null ? String(user.id) : "");
      localStorage.setItem("user_name", user.name || "");
      localStorage.setItem("user_username", user.username || "");
      localStorage.setItem("user_phone", user.phone_number || "");
      if (d.device?.label) localStorage.setItem("device_label", d.device.label);
      if (user.name) myUserName = user.name;
      // Rôle (patient/médecin) pour afficher le solde et piloter l'init d'appel.
      localStorage.setItem("user_role", user.role || "");
      updateIdentityUI();
    }

    function getOrCreateDeviceId() {
      // Aligne sur myDeviceId (yam_device_id) pour la cohérence des appels.
      if (myDeviceId) return myDeviceId;
      let id = localStorage.getItem("yam_device_id");
      if (!id) {
        id = (crypto.randomUUID && crypto.randomUUID()) ||
          ("device-" + Math.random().toString(36).substring(2, 10));
        localStorage.setItem("yam_device_id", id);
      }
      return id;
    }

    function showAuthScreen() {
      authScreen.classList.remove("hidden");
    }
    function hideAuthScreen() {
      authScreen.classList.add("hidden");
    }

    // Toggle login / register
    let authMode = "login";
    const authToggleLink = document.getElementById("auth-toggle-link");
    const authToggleText = document.getElementById("auth-toggle-text");
    authToggleLink.addEventListener("click", () => {
      clearAuthError();
      if (authMode === "login") {
        authMode = "register";
        loginForm.style.display = "none";
        registerForm.style.display = "block";
        authToggleText.textContent = "Déjà un compte ?";
        authToggleLink.textContent = "Se connecter";
      } else {
        authMode = "login";
        registerForm.style.display = "none";
        loginForm.style.display = "block";
        authToggleText.textContent = "Pas encore de compte ?";
        authToggleLink.textContent = "Créer un compte";
      }
    });

    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAuthError();
      const phone = document.getElementById("auth-phone").value.trim();
      const password = document.getElementById("auth-password").value;
      if (!phone || !password) { showAuthError("Merci de remplir tous les champs."); return; }
      try {
        const res = await fetch(getApiBase() + "/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone_number: phone,
            password,
            device_id: getOrCreateDeviceId(),
            platform: "web",
          }),
        });
        const data = await res.json();
        if (!res.ok) { showAuthError(extractAuthError(data)); return; }
        storeSession(data);
        hideAuthScreen();
        initNetwork();
        registerWebPush();
      } catch (err) {
        showAuthError("Impossible de joindre le serveur. Vérifiez qu'il est bien démarré.");
      }
    });

    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearAuthError();
      const name = document.getElementById("auth-name").value.trim();
      const phone = document.getElementById("auth-reg-phone").value.trim();
      const username = document.getElementById("auth-username").value.trim();
      const password = document.getElementById("auth-reg-password").value;
      const confirm = document.getElementById("auth-reg-password-confirm").value;
      if (!name || !phone || !password || !confirm) { showAuthError("Merci de remplir tous les champs."); return; }
      if (password !== confirm) { showAuthError("Les mots de passe ne correspondent pas."); return; }
      const body = {
        phone_number: phone,
        name,
        password,
        device_id: getOrCreateDeviceId(),
        platform: "web",
      };
      if (username) body.username = username;
      try {
        const res = await fetch(getApiBase() + "/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) { showAuthError(extractAuthError(data)); return; }
        storeSession(data);
        hideAuthScreen();
        initNetwork();
        registerWebPush();
      } catch (err) {
        showAuthError("Impossible de joindre le serveur. Vérifiez qu'il est bien démarré.");
      }
    });

    async function logout() {
      const token = authToken();
      try {
        if (token) {
          await fetch(getApiBase() + "/auth/logout", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Accept": "application/json"
            },
          });
        }
      } catch (err) { console.warn("[auth] Échec logout serveur", err); }
      // Déconnecte le WebSocket (Pusher) pour ne plus recevoir d'événements.
      if (pusher) { try { pusher.disconnect(); } catch (_) {} pusher = null; }
      localStorage.removeItem("auth_token");
      localStorage.removeItem("user_id");
      localStorage.removeItem("user_name");
      localStorage.removeItem("user_username");
      localStorage.removeItem("user_phone");
      localStorage.removeItem("user_role");
      if (typeof renderContacts === "function") renderContacts();
      if (typeof renderHistory === "function") renderHistory();
      showAuthScreen();
      setStatus("disconnected");
    }
    document.getElementById("btn-logout").addEventListener("click", logout);

    // Wrapper fetch authentifié avec interception automatique des 401 (session expirée)
    window.fetchAuth = async function(url, options = {}) {
      options.headers = options.headers || {};
      const token = authToken();
      if (token) {
        options.headers["Authorization"] = `Bearer ${token}`;
      }
      options.headers["Accept"] = "application/json";

      const res = await fetch(url, options);
      if (res.status === 401) {
        console.warn("[auth] Requête non autorisée (401), session révoquée.");
        logout();
        showAuthError("Votre session a expiré. Veuillez vous reconnecter.");
      }
      return res;
    };

    // Vérification de sécurité STRICTE avant de laisser entrer dans l'application
    window.verifyAuthOnStartup = async function() {
      const token = authToken();
      if (!token) {
        showAuthScreen();
        return false;
      }

      showAuthScreen();
      showAuthError("Vérification de la sécurité…");

      try {
        const res = await fetch(getApiBase() + "/users/me", {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Accept": "application/json"
          }
        });

        if (res.ok) {
          const data = await res.json();
          clearAuthError();
          storeSession(data);
          hideAuthScreen();
          return true;
        } else {
          console.warn("[auth] Token invalide ou expiré (HTTP " + res.status + ")");
          localStorage.removeItem("auth_token");
          localStorage.removeItem("user_id");
          localStorage.removeItem("user_name");
          localStorage.removeItem("user_username");
          localStorage.removeItem("user_phone");
          localStorage.removeItem("user_role");
          showAuthError("Session invalide ou expirée. Veuillez vous reconnecter.");
          showAuthScreen();
          return false;
        }
      } catch (err) {
        console.warn("[auth] Erreur réseau lors de la vérification de session :", err);
        showAuthError("Serveur injoignable. Vérifiez que l'API est démarrée en local.");
        showAuthScreen();
        return false;
      }
    };

    function setStatus(status) {
      statusDot.className = "status-dot " + status;
      if (status === "connected") statusLabel.textContent = "Connecté";
      else if (status === "connecting") statusLabel.textContent = "Connexion…";
      else statusLabel.textContent = "Déconnecté";
    }

    function sdpNormalise(sdp) {
      if (typeof sdp !== "string") return sdp;
      return sdp.endsWith("\r\n") ? sdp : sdp + "\r\n";
    }
