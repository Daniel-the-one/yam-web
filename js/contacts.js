// =========================================================
// contacts.js — Charge et affiche la liste de contacts
// =========================================================

document.addEventListener("DOMContentLoaded", () => {
  const listEl = document.getElementById("contacts-list");
  const errorEl = document.getElementById("contacts-error");
  const emptyEl = document.getElementById("contacts-empty");
  const searchEl = document.getElementById("contact-search");

  let allContacts = [];

  loadContacts();

  if (searchEl) {
    searchEl.addEventListener("input", () => {
      const query = searchEl.value.trim().toLowerCase();
      const filtered = allContacts.filter((c) => c.username.toLowerCase().includes(query));
      renderContacts(filtered);
    });
  }

  async function loadContacts() {
    try {
      const response = await fetch(`${API_BASE_URL}/contacts`);
      const data = await response.json();

      if (!response.ok) {
        showError(data.error?.message || "Impossible de charger les contacts.");
        return;
      }

      allContacts = data.contacts || [];
      renderContacts(allContacts);

    } catch (err) {
      showError("Impossible de joindre le serveur. Vérifiez qu'il est bien démarré.");
    }
  }

  function renderContacts(contacts) {
    if (!listEl) return;
    listEl.innerHTML = "";

    if (emptyEl) {
      emptyEl.hidden = contacts.length > 0;
    }

    contacts.forEach((contact) => {
      const item = document.createElement("li");
      item.className = "contact-item";

      // Avatar (lettre initiale — données sûres, on garde innerHTML pour la
      // structure statique mais on échappe le nom via textContent).
      const avatar = document.createElement("div");
      avatar.className = "contact-avatar";
      avatar.textContent = (contact.username || "?").charAt(0).toUpperCase();

      const info = document.createElement("div");
      info.className = "contact-info";
      const nameSpan = document.createElement("span");
      nameSpan.className = "contact-name";
      nameSpan.textContent = contact.username; // jamais innerHTML (XSS)
      const statusSpan = document.createElement("span");
      statusSpan.className = "contact-status";
      const dot = document.createElement("span");
      dot.className = "status-dot" + (contact.is_online ? " online" : "");
      statusSpan.appendChild(dot);
      statusSpan.appendChild(
        document.createTextNode(contact.is_online ? "En ligne" : "Hors ligne")
      );
      info.appendChild(nameSpan);
      info.appendChild(statusSpan);

      // Bouton d'appel audio
      const callBtn = document.createElement("button");
      callBtn.className = "icon-btn call-btn";
      callBtn.setAttribute("aria-label", "Appeler " + (contact.username || ""));
      callBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
      </svg>`;

      // Bouton d'appel vidéo
      const videoBtn = document.createElement("button");
      videoBtn.className = "icon-btn video-btn";
      videoBtn.setAttribute("aria-label", "Appel vidéo " + (contact.username || ""));
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
    let myDevId = localStorage.getItem("device_id");
    if (!myDevId) {
      myDevId = "device-" + Math.random().toString(36).substring(2, 10);
      localStorage.setItem("device_id", myDevId);
    }
    sessionStorage.setItem("call_target_user_id", contact.user_id);
    sessionStorage.setItem("call_target_username", contact.username);
    sessionStorage.setItem("call_target_device_id", contact.device_id);
    sessionStorage.setItem("call_type", type);
    window.location.href = "call.html";
  }

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.add("visible");
  }
});
