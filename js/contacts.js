// =========================================================
// contacts.js — Recherche et affiche les utilisateurs (contacts)
//
// Contrat backend (Sanctum) :
//   GET /api/v1/users/search?q=...&limit=20  (protégé, Bearer)
//   → {data: [{id, phone_number, name, username, phone_verified, role}]}
// =========================================================

document.addEventListener("DOMContentLoaded", () => {
  const listEl = document.getElementById("contacts-list");
  const errorEl = document.getElementById("contacts-error");
  const emptyEl = document.getElementById("contacts-empty");
  const searchEl = document.getElementById("contact-search");

  let debounceTimer = null;

  // Vérifie la session au montage : si le token est invalide/expiré (401),
  // on redirige vers la page de connexion.
  checkAuth();

  if (searchEl) {
    searchEl.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const query = searchEl.value.trim();
      // Le backend exige un minimum de 2 caractères pour la recherche.
      if (query.length < 2) {
        renderContacts([]);
        if (emptyEl) {
          emptyEl.hidden = false;
          emptyEl.textContent = "Commencez à taper (au moins 2 caractères) pour rechercher un contact.";
        }
        return;
      }
      // Debounce 300ms pour ne pas surcharger le serveur à chaque frappe.
      debounceTimer = setTimeout(() => searchContacts(query), 300);
    });
  }

  async function checkAuth() {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      window.location.href = "login.html";
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/users/me`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/json"
        },
      });
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("user_id");
        localStorage.removeItem("user_name");
        window.location.href = "login.html";
      }
    } catch (err) {
      console.warn("[contacts] Impossible de vérifier la session", err);
    }
  }

  async function searchContacts(query) {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      window.location.href = "login.html";
      return;
    }
    try {
      const response = await fetch(
        `${API_BASE_URL}/users/search?q=${encodeURIComponent(query)}&limit=20`,
        { headers: { "Authorization": `Bearer ${token}` } }
      );

      if (response.status === 401) {
        window.location.href = "login.html";
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        showError(data.error?.message || "Impossible de charger les contacts.");
        return;
      }

      const contacts = data.data || [];
      renderContacts(contacts);

    } catch (err) {
      showError("Impossible de joindre le serveur. Vérifiez qu'il est bien démarré.");
    }
  }

  function renderContacts(contacts) {
    if (!listEl) return;
    listEl.innerHTML = "";

    if (emptyEl) {
      emptyEl.hidden = contacts.length > 0;
      if (contacts.length === 0) {
        emptyEl.textContent = "Aucun contact trouvé.";
      }
    }

    contacts.forEach((contact) => {
      const item = document.createElement("li");
      item.className = "contact-item";

      // Avatar (lettre initiale — on échappe le nom via textContent).
      const displayName = contact.name || contact.username || "?";
      const avatar = document.createElement("div");
      avatar.className = "contact-avatar";
      avatar.textContent = displayName.charAt(0).toUpperCase();

      const info = document.createElement("div");
      info.className = "contact-info";
      const nameSpan = document.createElement("span");
      nameSpan.className = "contact-name";
      nameSpan.textContent = displayName; // jamais innerHTML (XSS)
      const phoneSpan = document.createElement("span");
      phoneSpan.className = "contact-status";
      phoneSpan.textContent = contact.phone_number || "";
      info.appendChild(nameSpan);
      info.appendChild(phoneSpan);

      // Bouton d'appel audio
      const callBtn = document.createElement("button");
      callBtn.className = "icon-btn call-btn";
      callBtn.setAttribute("aria-label", "Appeler " + displayName);
      callBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>`;

      // Bouton d'appel vidéo
      const videoBtn = document.createElement("button");
      videoBtn.className = "icon-btn video-btn";
      videoBtn.setAttribute("aria-label", "Appel vidéo " + displayName);
      videoBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M23 7l-7 5 7 5V7z"/>
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
      </svg>`;

      item.appendChild(avatar);
      item.appendChild(info);
      item.appendChild(callBtn);
      item.appendChild(videoBtn);

      callBtn.addEventListener("click", () => {
        startCall(contact, "audio");
      });
      videoBtn.addEventListener("click", () => {
        startCall(contact, "video");
      });

      listEl.appendChild(item);
    });
  }

  function startCall(contact, type) {
    // Le backend résout les appareils cibles depuis to_user_id : on ne
    // transmet plus le device_id du contact, seulement son id utilisateur.
    sessionStorage.setItem("call_target_user_id", contact.id);
    sessionStorage.setItem("call_target_username", contact.name || contact.username || "Inconnu");
    sessionStorage.setItem("call_type", type);
    window.location.href = "call.html";
  }

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.add("visible");
  }
});
