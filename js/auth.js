// =========================================================
// auth.js — Gère les formulaires de connexion ET d'inscription
// (chargé sur login.html et register.html)
// =========================================================

// Adresse de l'API. À adapter quand le serveur Laravel tournera
// en local (ex: "http://localhost:8000/api/v1").
const API_BASE_URL = "https://web-production-6a2e0.up.railway.app/api/v1";

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

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (!username || !password) {
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
        body: JSON.stringify({ username, password, device_id: deviceId }),
      });

      const data = await response.json();

      if (!response.ok) {
        showError(errorBox, data.error?.message || "Connexion impossible.");
        return;
      }

      localStorage.setItem("auth_token", data.token);
      localStorage.setItem("user_id", data.user_id);
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

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const passwordConfirm = document.getElementById("password-confirm").value;

    if (!username || !password || !passwordConfirm) {
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

    try {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          device_id: deviceId,
          platform: "web",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        showError(errorBox, data.error?.message || "Inscription impossible.");
        return;
      }

      localStorage.setItem("auth_token", data.token);
      localStorage.setItem("user_id", data.user_id);
      window.location.href = "contacts.html";

    } catch (err) {
      showError(errorBox, "Impossible de joindre le serveur. Vérifiez qu'il est bien démarré.");
    }
  });
}

// ---------------------------------------------------------
// Utilitaires partagés
// ---------------------------------------------------------

// Récupère le device_id déjà stocké, ou en crée un nouveau la première fois.
function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem("device_id");
  if (!deviceId) {
    deviceId = crypto.randomUUID(); // fonction native du navigateur, pas de librairie nécessaire
    localStorage.setItem("device_id", deviceId);
  }
  return deviceId;
}

function showError(errorBox, message) {
  errorBox.textContent = message;
  errorBox.classList.add("visible");
}
