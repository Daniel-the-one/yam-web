    // Contacts & History Storage (scopés par compte utilisateur)
    function currentUserId() {
      return localStorage.getItem("user_id") || "default";
    }

    function getContacts() {
      const uid = currentUserId();
      return JSON.parse(localStorage.getItem("yam_contacts_" + uid) || "[]");
    }
    function saveContacts(list) {
      const uid = currentUserId();
      localStorage.setItem("yam_contacts_" + uid, JSON.stringify(list));
      renderContacts();
    }
    // Échappe une chaîne pour une injection sûre dans innerHTML (texte/attributs).
    // NB : ne PAS utiliser pour construire du code JS (onclick) — voir les
    // handlers addEventListener ci-dessous qui éliminent ce vecteur.
    function esc(s) {
      const d = document.createElement("div");
      d.textContent = s == null ? "" : String(s);
      return d.innerHTML;
    }

    function renderContacts() {
      const contacts = getContacts();
      contactsListEl.innerHTML = "";
      if (contacts.length === 0) {
        contactsListEl.innerHTML = '<li style="text-align:center; color:var(--text-muted); padding:24px 0;">Aucun contact enregistré</li>';
        return;
      }
      contacts.forEach((c, idx) => {
        const li = document.createElement("li");
        li.className = "item-card";
        li.innerHTML = `
          <div class="item-info">
            <span class="item-name">${esc(c.name)}</span>
            <span class="item-sub">${esc(c.phone || c.userId || "")}</span>
          </div>
          <div class="item-actions">
            <button class="btn-icon" style="color:var(--accent);" title="Appeler" data-action="call">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            </button>
            <button class="btn-icon" style="color:var(--accent);" title="Appel vidéo" data-action="video">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            </button>
            <button class="btn-icon" title="Supprimer" data-action="delete">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        `;
        // Handlers via addEventListener + dataset : aucune concaténation de code
        // JS → élimine le vecteur XSS par injection dans les attributs onclick.
        li.querySelector('[data-action="call"]').addEventListener("click", () => {
          startOutgoingCall(c.userId, c.name);
        });
        li.querySelector('[data-action="video"]').addEventListener("click", () => {
          startOutgoingCall(c.userId, c.name, true);
        });
        li.querySelector('[data-action="delete"]').addEventListener("click", () => {
          deleteContact(idx);
        });
        contactsListEl.appendChild(li);
      });
    }
    window.deleteContact = (idx) => {
      const list = getContacts();
      list.splice(idx, 1);
      saveContacts(list);
    };

    function getHistory() {
      const uid = currentUserId();
      return JSON.parse(localStorage.getItem("yam_calls_" + uid) || "[]");
    }
    function saveHistory(history) {
      const uid = currentUserId();
      localStorage.setItem("yam_calls_" + uid, JSON.stringify(history));
      renderHistory();
    }

    function logCall(peerId, peerName, missed, peerUserId) {
      const history = getHistory();
      const now = Date.now();

      // Protection anti-doublon : ne pas insérer deux fois le même appel en moins de 3s
      if (history.length > 0) {
        const last = history[0];
        const lastTime = new Date(last.at).getTime();
        const samePeer = (peerUserId && last.peerUserId === peerUserId) || (last.peerId === peerId);
        if (samePeer && Math.abs(now - lastTime) < 3000) {
          console.log("[YAM] Doublon d'historique évité pour:", peerName || peerId);
          return;
        }
      }

      history.unshift({
        id: now.toString(),
        peerId,
        peerUserId: peerUserId || null,
        peerName: peerName || peerId,
        at: new Date(now).toISOString(),
        missed: !!missed
      });
      if (history.length > 50) history.pop();
      saveHistory(history);
    }

    function renderHistory() {
      const history = getHistory();
      historyListEl.innerHTML = "";
      if (history.length === 0) {
        historyListEl.innerHTML = '<li style="text-align:center; color:var(--text-muted); padding:24px 0;">Aucun appel dans l\'historique</li>';
        return;
      }
      history.forEach((h, idx) => {
        const d = new Date(h.at);
        const dateStr = String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth()+1).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
        const li = document.createElement("li");
        li.className = "item-card";
        li.innerHTML = `
          <div class="item-info">
            <div style="display:flex; align-items:center;">
              <span class="item-name" style="${h.missed ? 'color:var(--danger);' : ''}">${esc(h.peerName)}</span>
              ${h.missed ? '<span class="tag-missed">Manqué</span>' : ''}
            </div>
            <span class="item-sub">${esc(h.peerId)} · ${dateStr}</span>
          </div>
          <div class="item-actions">
            <button class="btn-icon" style="color:var(--accent);" title="Rappeler" data-action="call">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            </button>
            <button class="btn-icon" style="color:var(--accent);" title="Rappeler en vidéo" data-action="video">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            </button>
            <button class="btn-icon" title="Effacer" data-action="delete">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        `;
        // addEventListener + dataset : élimine le vecteur XSS des onclick.
        const callTarget = h.peerUserId || h.peerId;
        li.querySelector('[data-action="call"]').addEventListener("click", () => {
          startOutgoingCall(callTarget, h.peerName);
        });
        li.querySelector('[data-action="video"]').addEventListener("click", () => {
          startOutgoingCall(callTarget, h.peerName, true);
        });
        li.querySelector('[data-action="delete"]').addEventListener("click", () => {
          deleteHistory(idx);
        });
        historyListEl.appendChild(li);
      });
    }
    window.deleteHistory = (idx) => {
      const history = JSON.parse(localStorage.getItem("yam_calls") || "[]");
      history.splice(idx, 1);
      localStorage.setItem("yam_calls", JSON.stringify(history));
      renderHistory();
    };

    // Event Listeners
    btnCopyId.addEventListener("click", () => {
      navigator.clipboard.writeText(myDeviceId);
      alert("Identifiant copié dans le presse-papiers !");
    });

    btnEditName.addEventListener("click", () => {
      const newName = prompt("Modifier mon nom d'appareil :", myUserName);
      if (newName && newName.trim()) {
        myUserName = newName.trim();
        localStorage.setItem("yam_user_name", myUserName);
        updateIdentityUI();
      }
    });

    btnStartCall.addEventListener("click", () => {
      const q = targetInput.value.trim();
      if (!q) return;
      // Résout le téléphone/nom vers un user_id via la recherche, puis appelle.
      searchUsers(q).then((users) => {
        if (users && users.length > 0) {
          const u = users[0];
          startOutgoingCall(String(u.id), u.name || u.phone_number);
        } else {
          alert("Aucun utilisateur trouvé pour : " + q);
        }
      });
    });

    // ── Recherche d'utilisateurs (endpoint protégé /users/search) ──
    const searchUsersInput = document.getElementById("search-users-input");
    const searchUsersResults = document.getElementById("search-users-results");
    let searchUsersTimer = null;

    async function searchUsers(q) {
      if (!q) return [];
      try {
        const cleanBase = serverUrl.replace(/\/+$/, "");
        const fetchFn = window.fetchAuth || fetch;
        const res = await fetchFn(cleanBase + "/api/v1/users/search?q=" + encodeURIComponent(q) + "&limit=8");
        if (!res.ok) return [];
        const data = await res.json();
        return data.data || [];
      } catch (err) {
        console.error("Search error:", err);
        return [];
      }
    }

    function renderSearchResults(users, container) {
      container.innerHTML = "";
      if (!users || users.length === 0) {
        container.innerHTML = '<li class="search-empty">Aucun utilisateur trouvé</li>';
        return;
      }
      users.forEach((u) => {
        const li = document.createElement("li");
        li.className = "item-card";
        li.innerHTML = `
          <div class="item-info">
            <span class="item-name">${esc(u.name || u.phone_number)}</span>
            <span class="item-sub">${esc(u.phone_number || "")}${u.username ? " · @" + esc(u.username) : ""}</span>
          </div>
          <div class="item-actions">
            <button class="btn-icon" style="color:var(--accent);" title="Appeler" data-action="call">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
            </button>
            <button class="btn-icon" style="color:var(--accent);" title="Appel vidéo" data-action="video">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            </button>
            <button class="btn-icon" title="Ajouter aux contacts" data-action="add">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        `;
        li.querySelector('[data-action="call"]').addEventListener("click", () => {
          startOutgoingCall(String(u.id), u.name || u.phone_number);
        });
        li.querySelector('[data-action="video"]').addEventListener("click", () => {
          startOutgoingCall(String(u.id), u.name || u.phone_number, true);
        });
        li.querySelector('[data-action="add"]').addEventListener("click", () => {
          const list = getContacts();
          if (!list.some(c => String(c.userId) === String(u.id))) {
            list.push({ userId: String(u.id), name: u.name || u.phone_number, phone: u.phone_number });
            saveContacts(list);
          }
        });
        container.appendChild(li);
      });
    }

    // Recherche dans l'onglet Contacts (debounce 300ms)
    searchUsersInput.addEventListener("input", () => {
      clearTimeout(searchUsersTimer);
      const q = searchUsersInput.value.trim();
      if (!q) { searchUsersResults.innerHTML = ""; return; }
      searchUsersTimer = setTimeout(async () => {
        const users = await searchUsers(q);
        renderSearchResults(users, searchUsersResults);
      }, 300);
    });

    // Recherche dans le champ "Appel Direct" (résultats sous le champ)
    const directSearchResults = document.getElementById("direct-search-results");
    let directSearchTimer = null;
    targetInput.addEventListener("input", () => {
      clearTimeout(directSearchTimer);
      const q = targetInput.value.trim();
      if (!q) { directSearchResults.classList.remove("visible"); directSearchResults.innerHTML = ""; return; }
      directSearchTimer = setTimeout(async () => {
        const users = await searchUsers(q);
        directSearchResults.classList.add("visible");
        renderSearchResults(users, directSearchResults);
      }, 300);
    });

    document.getElementById("btn-accept-call").addEventListener("click", acceptIncomingCall);
    document.getElementById("btn-refuse-call").addEventListener("click", refuseIncomingCall);
    document.getElementById("btn-hangup").addEventListener("click", hangUp);
    document.getElementById("btn-toggle-mute").addEventListener("click", toggleMute);
    document.getElementById("btn-toggle-camera").addEventListener("click", toggleCamera);

    // Tab Navigation
    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById(btn.dataset.tab).classList.add("active");
      });
    });

    // Settings Modal
    const modalSettings = document.getElementById("modal-settings");
    btnSettings.addEventListener("click", () => {
      document.getElementById("settings-server-url").value = serverUrl;
      document.getElementById("settings-user-name").value = myUserName;
      modalSettings.classList.add("active");
    });
    document.getElementById("btn-cancel-settings").addEventListener("click", () => {
      modalSettings.classList.remove("active");
    });
    document.getElementById("btn-save-settings").addEventListener("click", () => {
      const u = document.getElementById("settings-server-url").value.trim();
      const n = document.getElementById("settings-user-name").value.trim();
      if (u) {
        serverUrl = u;
        localStorage.setItem("yam_server_url", serverUrl);
      }
      if (n) {
        myUserName = n;
        localStorage.setItem("yam_user_name", myUserName);
        updateIdentityUI();
      }
      modalSettings.classList.remove("active");
      initNetwork();
    });

