// =========================================================
// auth.js — Gère les formulaires de connexion ET d'inscription
// (chargé sur login.html et register.html)
//
// Contrat backend (Sanctum) :
//   POST /api/v1/auth/register → {data: {token, user, device}}
//   POST /api/v1/auth/login    → {data: {token, user, device?}}
//   POST /api/v1/auth/logout   → {data: {ok: true}}  (protégé)
// =========================================================

// Détection de l'hôte API (même logique que incoming-call-listener.js)
// pour fonctionner en local, via tunnel HTTPS ou en production.
function getApiBaseUrl() {
  const host = window.location.hostname || "192.168.1.80";
  const isLocal = host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.");
  const isTunnel = host.endsWith("trycloudflare.com");

  if (isLocal) {
    return `http://${host}:8000/api/v1`;
  }
  if (isTunnel) {
    return `${window.location.protocol}//${host}/api/v1`;
  }
  // Production : l'API et le client sont servis depuis le même hôte
  // (ex. https://yam.mdkrlabs.dev/api/v1).
  return `${window.location.protocol}//${window.location.host}/api/v1`;
}

const API_BASE_URL = getApiBaseUrl();

document.addEventListener("DOMContentLoaded", () => {
  setupLoginForm();
  setupRegisterForm();
});

// ---------------------------------------------------------
// Connexion
// ---------------------------------------------------------
function setupLoginForm() {
  const form = document.getElementById("login-form");
  const errorBox = document.getElementById("form-error");

  // Cette fonction ne fait rien si on n'est pas sur la page de connexion
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault(); // empêche le rechargement de la page

    const phoneNumber = document.getElementById("phone_number").value.trim();
    const password = document.getElementById("password").value;

    if (!phoneNumber || !password) {
      showError(errorBox, "Merci de remplir tous les champs.");
      return;
    }

    // ⚠️ Indispensable : envoyer le device_id actuel AU LOGIN aussi.
    // Sinon la BDD garde celui de l'inscription et, si l'appareil a
    // changé, les appels entrants partent vers un canal que personne
    // n'écoute (le téléphone ne sonne jamais).
    const deviceId = getOrCreateDeviceId();

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number: phoneNumber,
          password,
          device_id: deviceId,
          platform: "web",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        showError(errorBox, extractErrorMessage(data));
        return;
      }

      storeSession(data);
      window.location.href = "contacts.html";

    } catch (err) {
      showError(errorBox, "Impossible de joindre le serveur. Vérifiez qu'il est bien démarré.");
    }
  });
}

// ---------------------------------------------------------
// Inscription
// ---------------------------------------------------------
function setupRegisterForm() {
  const form = document.getElementById("register-form");
  const errorBox = document.getElementById("form-error");

  // Cette fonction ne fait rien si on n'est pas sur la page d'inscription
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const phoneNumber = document.getElementById("phone_number").value.trim();
    const name = document.getElementById("name").value.trim();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const passwordConfirm = document.getElementById("password-confirm").value;

    if (!phoneNumber || !name || !password || !passwordConfirm) {
      showError(errorBox, "Merci de remplir tous les champs.");
      return;
    }

    if (password !== passwordConfirm) {
      showError(errorBox, "Les mots de passe ne correspondent pas.");
      return;
    }

    // Chaque appareil a besoin d'un identifiant unique (device_id), généré
    // une seule fois puis conservé dans le navigateur.
    const deviceId = getOrCreateDeviceId();

    const body = {
      phone_number: phoneNumber,
      name,
      password,
      device_id: deviceId,
      platform: "web",
    };
    // Le username est optionnel : on ne l'envoie que s'il est rempli.
    if (username) body.username = username;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        showError(errorBox, extractErrorMessage(data));
        return;
      }

      storeSession(data);
      window.location.href = "contacts.html";

    } catch (err) {
      showError(errorBox, "Impossible de joindre le serveur. Vérifiez qu'il est bien démarré.");
    }
  });
}

// ---------------------------------------------------------
// Déconnexion
// ---------------------------------------------------------
async function logout() {
  const token = localStorage.getItem("auth_token");
  try {
    if (token) {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
      });
    }
  } catch (err) {
    console.warn("[auth] Échec de la déconnexion côté serveur", err);
  }
  // Nettoie la session locale dans tous les cas.
  localStorage.removeItem("auth_token");
  localStorage.removeItem("user_id");
  localStorage.removeItem("user_name");
  localStorage.removeItem("user_username");
  localStorage.removeItem("user_phone");
  window.location.href = "login.html";
}

// ---------------------------------------------------------
// Utilitaires partagés
// ---------------------------------------------------------

// Stocke la session issue de register/login.
// Réponse attendue : {data: {token, user: {id, name, username, phone_number}, device}}
function storeSession(data) {
  const d = data?.data || {};
  localStorage.setItem("auth_token", d.token || "");
  const user = d.user || {};
  localStorage.setItem("user_id", user.id != null ? String(user.id) : "");
  localStorage.setItem("user_name", user.name || "");
  localStorage.setItem("user_username", user.username || "");
  localStorage.setItem("user_phone", user.phone_number || "");
  if (d.device?.label) localStorage.setItem("device_label", d.device.label);
}

// Extrait un message d'erreur lisible depuis les différents formats backend.
function extractErrorMessage(data) {
  if (!data) return "Une erreur inattendue s'est produite.";
  // Format ValidationException Laravel : {errors: {field: [messages]}}
  if (data.errors) {
    const firstField = Object.keys(data.errors)[0];
    const messages = data.errors[firstField];
    return Array.isArray(messages) && messages.length ? messages[0] : "Erreur de validation.";
  }
  // Format CallController : {error: {code, message}}
  if (data.error?.message) return data.error.message;
  // Format Sanctum : {message: "..."}
  if (data.message) return data.message;
  return "Une erreur inattendue s'est produite.";
}

// Récupère le device_id déjà stocké, ou en crée un nouveau la première fois.
// Utilise la clé `yam_device_id` (cohérente avec le SPA spa-*.js). Migre
// depuis l'ancienne clé `device_id` si elle existait.
function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem("yam_device_id");
  if (!deviceId) {
    // Migration depuis l'ancienne clé (avant unification)
    deviceId = localStorage.getItem("device_id");
    if (deviceId) {
      localStorage.setItem("yam_device_id", deviceId);
      localStorage.removeItem("device_id");
    } else {
      deviceId = (crypto.randomUUID && crypto.randomUUID()) ||
        ("device-" + Math.random().toString(36).substring(2, 10));
      localStorage.setItem("yam_device_id", deviceId);
    }
  }
  return deviceId;
}

function showError(errorBox, message) {
  errorBox.textContent = message;
  errorBox.classList.add("visible");
}
