// ─────────── KondjiPro — Dossier médical & Facturation ───────────
    // Intègre les écrans médicaux KondjiPro dans la SPA, branchés sur les
    // MÊMES APIs que le mobile (api/public/api/*.php + /api/demo/v1).
    //
    // Authentification (identique au portail PHP) :
    //   1. POST /api/auth/login.php → le navigateur reçoit le cookie de
    //      session `kondjipro_session` (même origine → credentials include)
    //      et le JSON renvoie un `csrf_token` (persisté en localStorage) ;
    //   2. chaque POST envoie le header `X-CSRF-Token` ;
    //   3. sur 401 (session expirée), UN re-login silencieux avec les
    //      identifiants conservés en mémoire, puis nouvel essai.
    //
    // Famille « argent » (solde, encaissement) : en mode démo
    // (isDemoMode()), les endpoints /api/demo/v1/kondjipro/* exigent le
    // jeton Bearer démo — porté par auth_token via window.fetchAuth.
    (() => {
      const KPRO_PREFIX = "/api";

      // ── État de session (identifiants EN MÉMOIRE uniquement) ──
      let kproIdentifier = null;
      let kproPassword = null;

      function kproBase() {
        return serverUrl.replace(/\/+$/, "") + KPRO_PREFIX;
      }
      function kproCsrf() {
        return localStorage.getItem("kpro_csrf");
      }
      function kproHasSession() {
        return !!kproCsrf();
      }

      // ── Connexion / déconnexion ──
      async function kproLogin(identifier, password) {
        const res = await fetch(kproBase() + "/auth/login.php", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ identifier, password }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.message || `Connexion médicale refusée (HTTP ${res.status}).`);
        }
        const csrf = data?.csrf_token;
        if (!csrf) {
          throw new Error("Réponse de connexion médicale invalide (pas de token CSRF).");
        }
        localStorage.setItem("kpro_csrf", csrf);
        kproIdentifier = identifier;
        kproPassword = password;
        return data;
      }

      async function kproLogout() {
        try {
          await fetch(kproBase() + "/auth/logout.php", {
            method: "POST",
            credentials: "include",
            headers: { "Accept": "application/json" },
          });
        } catch (_) { /* le nettoyage local reste nécessaire */ }
        localStorage.removeItem("kpro_csrf");
        kproIdentifier = null;
        kproPassword = null;
      }

      // Login médical SILENCIEUX : réutilise les identifiants Yam (comme le
      // mobile). Ne lève JAMAIS d'erreur — un échec laisse simplement le
      // bandeau « session non ouverte » visible.
      async function kproLoginSilent(identifier, password) {
        if (!identifier || !password) return false;
        try {
          await kproLogin(identifier, password);
          kproShowSessionBanner();
          loadPatients();
          renderFactures();
          renderOrdonnances();
          renderSolde();
          return true;
        } catch (_) {
          kproShowSessionBanner();
          return false;
        }
      }

      // ── Wrapper fetch authentifié (cookie + CSRF + re-login) ──
      async function kproFetch(path, { method = "GET", form, isRetry = false } = {}) {
        if (!kproHasSession()) {
          throw new Error("Session médicale absente — connectez-vous (Dossier → Connexion médicale).");
        }
        const headers = { "Accept": "application/json" };
        if (method !== "GET") headers["X-CSRF-Token"] = kproCsrf();
        let body;
        if (form) {
          headers["Content-Type"] = "application/x-www-form-urlencoded";
          body = new URLSearchParams(form).toString();
        }
        const res = await fetch(kproBase() + path, {
          method,
          credentials: "include",
          headers,
          body,
        });

        // Session expirée côté serveur → 1 re-login silencieux puis nouvel essai.
        if (res.status === 401 && !isRetry && kproIdentifier && kproPassword) {
          try {
            await kproLogin(kproIdentifier, kproPassword);
            return kproFetch(path, { method, form, isRetry: true });
          } catch (_) { /* on laisse le 401 remonter ci-dessous */ }
        }

        const data = await res.json().catch(() => null);
        if (res.status === 403) {
          throw new Error(data?.message || "Accès refusé (HTTP 403).");
        }
        if (!res.ok) {
          throw new Error(data?.message || `Erreur API médicale (HTTP ${res.status}).`);
        }
        if (data?.ok === false) {
          throw new Error(data.message || "Opération refusée par le serveur.");
        }
        return data || {};
      }

      // ── API métier : patients ──
      async function kproPatients(query) {
        const q = (query || "").trim();
        const data = await kproFetch(`/patients.php${q ? "?q=" + encodeURIComponent(q) : ""}`);
        return Array.isArray(data.results) ? data.results : [];
      }

      async function kproPatientDetail(id) {
        const data = await kproFetch(`/patients.php?id=${encodeURIComponent(id)}`);
        return {
          patient: data.patient && typeof data.patient === "object" ? data.patient : null,
          historique: Array.isArray(data.historique) ? data.historique : [],
        };
      }

      // ── API métier : factures & ordonnances ──
      async function kproFactures() {
        const data = await kproFetch("/factures.php");
        return Array.isArray(data.factures) ? data.factures : [];
      }

      async function kproOrdonnances() {
        const data = await kproFetch("/ordonnances.php");
        return Array.isArray(data.ordonnances) ? data.ordonnances : [];
      }

      async function kproSaveFacture(patientId, codes) {
        const form = { patient: String(patientId) };
        codes.forEach((c) => { form["actes[]"] = c; }); // clé répétée → URLSearchParams gère
        return kproFetch("/facture_save.php", { method: "POST", form });
      }

      async function kproSaveOrdonnance(patientId, meds) {
        const form = { patient: String(patientId), notes: "" };
        meds.forEach((m, i) => {
          form[`med[${i}][nom]`] = m.nom || "";
          form[`med[${i}][quantite]`] = m.quantite || "1";
          form[`med[${i}][unite]`] = m.unite || "";
          form[`med[${i}][frequence]`] = m.frequence || "";
        });
        return kproFetch("/ordonnance_save.php", { method: "POST", form });
      }

      // ── API métier : argent (solde, encaissement) ──
      function kproIsDemoMoney() {
        return isDemoMode();
      }

      async function kproSolde() {
        if (kproIsDemoMoney()) {
          // Démo : jeton Bearer démo porté par auth_token (fetchAuth).
          const res = await window.fetchAuth(apiUrl("/kondjipro/solde"));
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error(data?.message || `Erreur solde (HTTP ${res.status}).`);
          return parseInt(data?.solde ?? 0, 10) || 0;
        }
        // Réel : GET medecin.php renvoie déjà le champ `solde`.
        const data = await kproFetch("/medecin.php");
        return parseInt(data?.solde ?? 0, 10) || 0;
      }

      async function kproEncaisser(patientId, montant, motif) {
        const form = {
          patient_id: String(patientId),
          montant: String(montant),
          motif: motif || "",
        };
        if (kproIsDemoMoney()) {
          const res = await window.fetchAuth(apiUrl("/kondjipro/encaissement"), {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(form).toString(),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error(data?.message || `Erreur encaissement (HTTP ${res.status}).`);
          return data || {};
        }
        return kproFetch("/encaissement_create.php", { method: "POST", form });
      }

      // ── Résolution patient (téléphone → id) ──
      async function kproResolvePatientId({ phone, knownId }) {
        if (knownId && String(knownId).trim() !== "") {
          const id = parseInt(knownId, 10);
          if (!Number.isNaN(id)) return id;
        }
        const digits = (phone || "").replace(/\D/g, "");
        if (digits.length < 8) return null;
        const tail = digits.slice(-8);
        const rows = await kproPatients(tail);
        for (const row of rows) {
          const rowDigits = String(row.telephone || "").replace(/\D/g, "");
          if (rowDigits.endsWith(tail)) {
            const id = parseInt(row.id, 10);
            if (!Number.isNaN(id)) return id;
          }
        }
        return null;
      }

      // ═══════════════════════════════════════════════════════════════
      //  UI — Onglet Dossier médical
      // ═══════════════════════════════════════════════════════════════

      const patientsListEl = document.getElementById("kpro-patients-list");
      const patientsViewEl = document.getElementById("kpro-patients-view");
      const patientDetailEl = document.getElementById("kpro-patient-detail");
      const sessionBannerEl = document.getElementById("kpro-session-banner");
      const sessionFormEl = document.getElementById("kpro-session-form");
      const patientSearchEl = document.getElementById("kpro-patient-search");

      let kproSelectedPatient = null; // patient courant (détail / formulaires)

      function kproInitials(name) {
        return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2)
          .map((w) => w[0].toUpperCase()).join("") || "?";
      }

      function kproFormatMontant(value) {
        return Number(value || 0).toLocaleString("fr-FR").replace(/\u202f/g, " ") + " FCFA";
      }

      function kproAge(dateNaissance) {
        if (!dateNaissance) return "";
        const birth = new Date(dateNaissance);
        if (Number.isNaN(birth.getTime())) return "";
        const now = new Date();
        let age = now.getFullYear() - birth.getFullYear();
        const m = now.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
        return age >= 0 ? String(age) : "";
      }

      function kproShowSessionBanner() {
        if (!sessionBannerEl) return;
        if (kproHasSession()) {
          sessionBannerEl.hidden = true;
          sessionFormEl.hidden = true;
          return;
        }
        sessionBannerEl.hidden = false;
        sessionBannerEl.innerHTML =
          '<span>Session médicale non ouverte — les données KondjiPro sont indisponibles.</span>' +
          '<button type="button" id="kpro-btn-open-login" class="btn-text">Se connecter</button>';
        document.getElementById("kpro-btn-open-login").addEventListener("click", () => {
          sessionFormEl.hidden = false;
          sessionBannerEl.hidden = true;
        });
      }

      function kproBindSessionForm() {
        const form = document.getElementById("kpro-session-form");
        if (!form) return;
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const msg = document.getElementById("kpro-session-message");
          const identifier = document.getElementById("kpro-session-identifier").value.trim();
          const password = document.getElementById("kpro-session-password").value;
          msg.textContent = "";
          if (!identifier || !password) { msg.textContent = "Merci de remplir tous les champs."; return; }
          try {
            await kproLogin(identifier, password);
            form.hidden = true;
            kproShowSessionBanner();
            loadPatients();
            renderFactures();
            renderOrdonnances();
            renderSolde();
          } catch (err) {
            msg.textContent = err.message || "Connexion médicale impossible.";
          }
        });
      }

      async function loadPatients() {
        if (!patientsListEl) return;
        if (!kproHasSession()) {
          patientsListEl.replaceChildren();
          kproShowSessionBanner();
          return;
        }
        patientsListEl.innerHTML = '<li class="search-empty">Chargement…</li>';
        try {
          const rows = await kproPatients(patientSearchEl ? patientSearchEl.value : "");
          renderPatientList(rows);
        } catch (err) {
          patientsListEl.innerHTML =
            `<li class="search-empty">${escapeHtml(err.message || "Impossible de charger les patients.")}</li>` +
            '<li><button type="button" id="kpro-btn-retry-patients" class="btn-primary">Réessayer</button></li>';
          document.getElementById("kpro-btn-retry-patients")?.addEventListener("click", loadPatients);
        }
      }

      function renderPatientList(rows) {
        patientsListEl.replaceChildren();
        if (!rows.length) {
          const empty = document.createElement("li");
          empty.className = "search-empty";
          empty.textContent = "Aucun patient trouvé.";
          patientsListEl.appendChild(empty);
          return;
        }
        rows.forEach((p) => {
          const li = document.createElement("li");
          li.className = "item-card kpro-patient-card";
          li.innerHTML =
            `<div class="kpro-avatar">${kproInitials(p.nom)}</div>` +
            `<div class="item-info">` +
            `<span class="item-name">${escapeHtml(p.nom || "Patient inconnu")}</span>` +
            `<span class="item-sub">${escapeHtml(p.telephone || "")}</span>` +
            `<span class="item-sub">Né le ${escapeHtml(p.date_naissance || "—")}</span>` +
            `</div>` +
            `<span class="kpro-chevron">›</span>`;
          li.addEventListener("click", () => openPatientDetail(p));
          patientsListEl.appendChild(li);
        });
      }

      // ── Détail patient ──
      async function openPatientDetail(patient) {
        kproSelectedPatient = patient;
        patientsViewEl.hidden = true;
        patientDetailEl.hidden = false;
        patientDetailEl.innerHTML = '<div class="search-empty">Chargement du dossier…</div>';
        try {
          const { patient: detail, historique } = await kproPatientDetail(patient.id);
          if (detail) kproSelectedPatient = detail;
          renderPatientDetail(detail || patient, historique);
        } catch (err) {
          patientDetailEl.innerHTML =
            `<div class="kpro-error-banner">${escapeHtml(err.message || "Impossible de charger le dossier.")}</div>` +
            '<button type="button" id="kpro-btn-retry-detail" class="btn-primary">Réessayer</button>';
          document.getElementById("kpro-btn-retry-detail")?.addEventListener("click", () => openPatientDetail(patient));
        }
      }

      function renderPatientDetail(patient, historique) {
        const age = kproAge(patient.date_naissance);
        const sexe = patient.sexe || "—";
        const badges = [];
        if (patient.groupe_sanguin) {
          badges.push(`<span class="kpro-badge kpro-badge-primary">Groupe ${escapeHtml(patient.groupe_sanguin)}</span>`);
        }
        if (patient.allergies) {
          badges.push(`<span class="kpro-badge kpro-badge-accent">Allergies : ${escapeHtml(patient.allergies)}</span>`);
        }

        const events = (historique || []).map((row) => {
          const type = row.type || "consult";
          const icon = type === "ord" ? "💊" : type === "facture" ? "🧾" : type === "analyse" ? "🔬" : "🩺";
          const badge = type === "ord" ? "Délivrée" : type === "facture" ? "Facturée" : type === "analyse" ? "Résultats" : "Terminé";
          return (
            `<div class="kpro-event-card">` +
            `<div class="kpro-event-head">` +
            `<span class="kpro-event-icon">${icon}</span>` +
            `<div class="item-info">` +
            `<span class="item-name">${escapeHtml(row.titre || "Événement médical")}</span>` +
            `<span class="item-sub">${escapeHtml(row.date || "")}</span>` +
            `</div>` +
            `<span class="kpro-badge ${type === "facture" || type === "analyse" ? "kpro-badge-accent" : "kpro-badge-primary"}">${badge}</span>` +
            `</div>` +
            (row.desc ? `<p class="kpro-event-desc">${escapeHtml(row.desc)}</p>` : "") +
            `</div>`
          );
        }).join("");

        patientDetailEl.innerHTML =
          `<div class="kpro-detail-top">` +
          `<button type="button" id="kpro-btn-back-patients" class="btn-text">← Retour</button>` +
          `</div>` +
          `<div class="card kpro-detail-header">` +
          `<div class="kpro-detail-row">` +
          `<div class="kpro-avatar kpro-avatar-lg">${kproInitials(patient.nom)}</div>` +
          `<div class="item-info">` +
          `<span class="item-name" style="font-size:1rem;">${escapeHtml(patient.nom || "Patient inconnu")}</span>` +
          `<span class="item-sub">${escapeHtml(sexe)} • ${age ? age + " ans" : ""} (né le ${escapeHtml(patient.date_naissance || "—")})</span>` +
          `<span class="item-sub">📞 ${escapeHtml(patient.telephone || "")}</span>` +
          `</div>` +
          `</div>` +
          (badges.length ? `<div class="kpro-badges-row">${badges.join("")}</div>` : "") +
          `<div class="kpro-actions-row">` +
          `<button type="button" class="kpro-action-btn kpro-action-primary" data-kpro-action="prescrire">💊 Prescrire</button>` +
          `<button type="button" class="kpro-action-btn kpro-action-accent" data-kpro-action="facturer">🧾 Facturer</button>` +
          `<button type="button" class="kpro-action-btn" data-kpro-action="encaisser">💳 Encaisser</button>` +
          `</div>` +
          `</div>` +
          `<div class="section-title">Historique médical</div>` +
          (events || '<div class="search-empty">Aucun événement médical enregistré pour ce patient.</div>');

        document.getElementById("kpro-btn-back-patients").addEventListener("click", () => {
          patientDetailEl.hidden = true;
          patientsViewEl.hidden = false;
          loadPatients();
        });
        patientDetailEl.querySelectorAll("[data-kpro-action]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const action = btn.dataset.kproAction;
            if (action === "prescrire") openOrdonnanceForm(kproSelectedPatient);
            else if (action === "facturer") openFactureForm(kproSelectedPatient);
            else if (action === "encaisser") openEncaisser(kproSelectedPatient);
          });
        });
      }

      // ═══════════════════════════════════════════════════════════════
      //  UI — Onglet Facturation (sous-vues)
      // ═══════════════════════════════════════════════════════════════

      const SUBVIEWS = ["factures", "ordonnances", "encaisser", "form-facture", "form-ordonnance"];

      // Actes de soins (alignés sur le mobile facturer_screen.dart).
      const KPRO_ACTES = [
        { code: "C001", label: "Consultation générale", prix: 5000 },
        { code: "C002", label: "Pansement simple", prix: 3000 },
        { code: "C003", label: "Injection IM/IV", prix: 2500 },
        { code: "C004", label: "Soins infirmiers", prix: 2000 },
        { code: "C005", label: "Visite à domicile", prix: 10000 },
        { code: "C006", label: "Certificat médical", prix: 2500 },
      ];
      // C001 et C003 pré-cochés (comportement mobile).
      const KPRO_ACTES_PRESELECT = ["C001", "C003"];

      function populateActesList() {
        const container = document.getElementById("kpro-actes-list");
        if (!container) return;
        container.innerHTML = KPRO_ACTES.map((a) =>
          `<label class="kpro-acte-item">` +
          `<input type="checkbox" class="kpro-acte-check" value="${a.code}" data-prix="${a.prix}"` +
          (KPRO_ACTES_PRESELECT.includes(a.code) ? " checked" : "") + `>` +
          `<span class="item-info">` +
          `<span class="item-name">${escapeHtml(a.label)}</span>` +
          `<span class="item-sub">${a.code}</span>` +
          `</span>` +
          `<span class="kpro-acte-prix">${kproFormatMontant(a.prix)}</span>` +
          `</label>`
        ).join("");
        updateFactureTotal();
      }

      function showKproSub(sub) {
        SUBVIEWS.forEach((s) => {
          const el = document.getElementById("kpro-sub-" + s);
          if (el) el.hidden = s !== sub;
        });
        document.querySelectorAll(".kpro-subnav-btn").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.kproSub === sub);
        });
        if (sub === "factures") renderFactures();
        if (sub === "ordonnances") renderOrdonnances();
        if (sub === "encaisser") { renderSolde(); }
      }

      function kproBindSubnav() {
        document.querySelectorAll(".kpro-subnav-btn").forEach((btn) => {
          btn.addEventListener("click", () => showKproSub(btn.dataset.kproSub));
        });
        // Boutons retour des formulaires (data-kpro-back="<sous-vue cible>").
        document.querySelectorAll("[data-kpro-back]").forEach((btn) => {
          btn.addEventListener("click", () => showKproSub(btn.dataset.kproBack));
        });
        // Boutons « Nouvelle facture / Nouvelle ordonnance ».
        document.getElementById("kpro-btn-new-facture")?.addEventListener("click", () => openFactureForm(null));
        document.getElementById("kpro-btn-new-ordonnance")?.addEventListener("click", () => openOrdonnanceForm(null));
      }

      // ── Factures ──
      async function renderFactures() {
        const listEl = document.getElementById("kpro-factures-list");
        if (!listEl) return;
        if (!kproHasSession()) {
          listEl.innerHTML = '<li class="search-empty">Session médicale requise.</li>';
          kproShowSessionBanner();
          return;
        }
        listEl.innerHTML = '<li class="search-empty">Chargement…</li>';
        try {
          const rows = await kproFactures();
          listEl.replaceChildren();
          if (!rows.length) {
            const empty = document.createElement("li");
            empty.className = "search-empty";
            empty.textContent = "Aucune facture enregistrée.";
            listEl.appendChild(empty);
            return;
          }
          rows.forEach((f) => {
            const payee = f.statut === "payee";
            const li = document.createElement("li");
            li.className = "item-card kpro-facture-card";
            li.innerHTML =
              `<div class="kpro-facture-icon ${payee ? "kpro-icon-primary" : "kpro-icon-accent"}">🧾</div>` +
              `<div class="item-info">` +
              `<span class="item-name">${escapeHtml(f.patient || "Patient inconnu")}</span>` +
              `<span class="item-sub">${escapeHtml(f.numero || "")} · ${escapeHtml(f.date || "")}</span>` +
              `</div>` +
              `<div style="text-align:right;">` +
              `<div class="kpro-facture-montant">${kproFormatMontant(f.montant)}</div>` +
              `<span class="kpro-badge ${payee ? "kpro-badge-primary" : "kpro-badge-accent"}">${payee ? "Payée" : "En attente"}</span>` +
              `</div>`;
            listEl.appendChild(li);
          });
        } catch (err) {
          listEl.innerHTML = `<li class="search-empty">${escapeHtml(err.message || "Impossible de charger les factures.")}</li>`;
        }
      }

      function openFactureForm(patient) {
        kproSelectedPatient = patient || kproSelectedPatient || null;
        showKproSub("form-facture");
        const phoneEl = document.getElementById("kpro-facture-phone");
        if (phoneEl && kproSelectedPatient?.telephone) phoneEl.value = kproSelectedPatient.telephone;
        updateFactureTotal();
      }

      function updateFactureTotal() {
        const total = Array.from(document.querySelectorAll(".kpro-acte-check:checked"))
          .reduce((sum, cb) => sum + (parseInt(cb.dataset.prix, 10) || 0), 0);
        const el = document.getElementById("kpro-facture-total");
        if (el) el.textContent = kproFormatMontant(total);
        const count = document.querySelectorAll(".kpro-acte-check:checked").length;
        const countEl = document.getElementById("kpro-facture-count");
        if (countEl) countEl.textContent = count + " sélectionné(s)";
      }

      function kproBindFactureForm() {
        const form = document.getElementById("kpro-form-facture");
        if (!form) return;
        // `change` (plutôt que `click`) : couvre le clic direct sur la case,
        // le clic sur le texte du <label> et la saisie clavier.
        form.addEventListener("change", (e) => {
          if (e.target.classList.contains("kpro-acte-check")) updateFactureTotal();
        });
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const msg = document.getElementById("kpro-facture-message");
          const btn = form.querySelector('button[type="submit"]');
          const phone = document.getElementById("kpro-facture-phone").value.trim();
          const codes = Array.from(document.querySelectorAll(".kpro-acte-check:checked"))
            .map((cb) => cb.value);
          msg.textContent = "";
          if (!codes.length) { msg.textContent = "Veuillez sélectionner au moins un acte."; return; }
          btn.disabled = true;
          try {
            const patientId = await kproResolvePatientId({
              phone,
              knownId: kproSelectedPatient?.id,
            });
            if (patientId == null) {
              msg.textContent = "Aucun patient trouvé pour le numéro " + phone + ".";
              return;
            }
            await kproSaveFacture(patientId, codes);
            msg.textContent = "Facture enregistrée (" + codes.length + " acte(s)).";
            form.reset();
            updateFactureTotal();
            setTimeout(() => showKproSub("factures"), 900);
          } catch (err) {
            msg.textContent = err.message || "Impossible d'enregistrer la facture.";
          } finally {
            btn.disabled = false;
          }
        });
      }

      // ── Ordonnances ──
      async function renderOrdonnances() {
        const listEl = document.getElementById("kpro-ordonnances-list");
        if (!listEl) return;
        if (!kproHasSession()) {
          listEl.innerHTML = '<li class="search-empty">Session médicale requise.</li>';
          kproShowSessionBanner();
          return;
        }
        listEl.innerHTML = '<li class="search-empty">Chargement…</li>';
        try {
          const rows = await kproOrdonnances();
          listEl.replaceChildren();
          if (!rows.length) {
            const empty = document.createElement("li");
            empty.className = "search-empty";
            empty.textContent = "Aucune ordonnance enregistrée.";
            listEl.appendChild(empty);
            return;
          }
          rows.forEach((o) => {
            const meds = Array.isArray(o.medicaments)
              ? o.medicaments.map((m) => m.nom || "").filter(Boolean).join(", ")
              : "";
            const li = document.createElement("li");
            li.className = "item-card kpro-ordonnance-card";
            li.innerHTML =
              `<div class="kpro-facture-icon kpro-icon-primary">💊</div>` +
              `<div class="item-info">` +
              `<span class="item-name">${escapeHtml(o.patient || "Patient inconnu")}</span>` +
              `<span class="item-sub">${escapeHtml(o.numero || "")} · ${escapeHtml(o.date || "")}</span>` +
              `<span class="item-sub">${escapeHtml(meds || o.notes || "")}</span>` +
              `</div>` +
              `<span class="kpro-chevron">›</span>`;
            listEl.appendChild(li);
          });
        } catch (err) {
          listEl.innerHTML = `<li class="search-empty">${escapeHtml(err.message || "Impossible de charger les ordonnances.")}</li>`;
        }
      }

      function openOrdonnanceForm(patient) {
        kproSelectedPatient = patient || kproSelectedPatient || null;
        showKproSub("form-ordonnance");
        const phoneEl = document.getElementById("kpro-ordonnance-phone");
        if (phoneEl && kproSelectedPatient?.telephone) phoneEl.value = kproSelectedPatient.telephone;
      }

      function kproAddMedicament() {
        const container = document.getElementById("kpro-meds-container");
        const count = container.querySelectorAll(".kpro-med-block").length + 1;
        const div = document.createElement("div");
        div.className = "kpro-med-block";
        div.innerHTML =
          `<div class="kpro-med-head"><span class="kpro-med-num">${count}</span><span>Médicament ${count}</span>` +
          `<button type="button" class="kpro-med-remove" title="Supprimer">✕</button></div>` +
          `<div class="wallet-field"><label>Dénomination & Dosage</label>` +
          `<input type="text" class="kpro-med-nom" placeholder="Ex: Paracétamol 500 mg" required></div>` +
          `<div class="kpro-med-grid">` +
          `<div class="wallet-field"><label>Qté</label><input type="number" class="kpro-med-quantite" value="10" min="1" required></div>` +
          `<div class="wallet-field"><label>Unité</label><select class="kpro-med-unite">` +
          ["Comprimés", "Gélules", "Sirops", "Ampoules", "Sachets", "Flacons", "Gouttes", "Pommade"]
            .map((u) => `<option>${u}</option>`).join("") +
          `</select></div>` +
          `<div class="wallet-field"><label>Fréquence</label><select class="kpro-med-frequence">` +
          ["1 fois/jour", "2 fois/jour", "3 fois/jour", "4 fois/jour", "Matin et Soir", "Si besoin", "Toutes les 8h"]
            .map((f) => `<option>${f}</option>`).join("") +
          `</select></div>` +
          `</div>`;
        div.querySelector(".kpro-med-remove").addEventListener("click", () => div.remove());
        container.appendChild(div);
      }

      function kproBindOrdonnanceForm() {
        const form = document.getElementById("kpro-form-ordonnance");
        if (!form) return;
        document.getElementById("kpro-btn-add-med")?.addEventListener("click", kproAddMedicament);
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const msg = document.getElementById("kpro-ordonnance-message");
          const btn = form.querySelector('button[type="submit"]');
          const phone = document.getElementById("kpro-ordonnance-phone").value.trim();
          const meds = Array.from(document.querySelectorAll(".kpro-med-block")).map((block) => ({
            nom: block.querySelector(".kpro-med-nom").value.trim(),
            quantite: block.querySelector(".kpro-med-quantite").value.trim() || "1",
            unite: block.querySelector(".kpro-med-unite").value,
            frequence: block.querySelector(".kpro-med-frequence").value,
          }));
          msg.textContent = "";
          if (!meds.length || !meds[0].nom) { msg.textContent = "Veuillez saisir au moins un médicament."; return; }
          btn.disabled = true;
          try {
            const patientId = await kproResolvePatientId({
              phone,
              knownId: kproSelectedPatient?.id,
            });
            if (patientId == null) {
              msg.textContent = "Aucun patient trouvé pour le numéro " + phone + ".";
              return;
            }
            await kproSaveOrdonnance(patientId, meds);
            msg.textContent = "Ordonnance enregistrée (" + meds.length + " médicament(s)).";
            form.reset();
            document.getElementById("kpro-meds-container").innerHTML = "";
            kproAddMedicament();
            setTimeout(() => showKproSub("ordonnances"), 900);
          } catch (err) {
            msg.textContent = err.message || "Impossible d'enregistrer l'ordonnance.";
          } finally {
            btn.disabled = false;
          }
        });
      }

      // ── Encaisser (QR KondjiPay) ──
      async function renderSolde() {
        const el = document.getElementById("kpro-solde");
        if (!el) return;
        el.textContent = "Chargement…";
        try {
          const solde = await kproSolde();
          el.textContent = kproFormatMontant(solde);
        } catch (err) {
          el.textContent = "Indisponible";
          const msg = document.getElementById("kpro-encaisser-message");
          if (msg) msg.textContent = err.message || "Solde indisponible.";
        }
      }

      function openEncaisser(patient) {
        kproSelectedPatient = patient || kproSelectedPatient || null;
        showKproSub("encaisser");
        const phoneEl = document.getElementById("kpro-encaisser-phone");
        if (phoneEl && kproSelectedPatient?.telephone) phoneEl.value = kproSelectedPatient.telephone;
        renderSolde();
      }

      function kproBindEncaisserForm() {
        const form = document.getElementById("kpro-form-encaisser");
        if (!form) return;
        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const msg = document.getElementById("kpro-encaisser-message");
          const btn = form.querySelector('button[type="submit"]');
          const phone = document.getElementById("kpro-encaisser-phone").value.trim();
          const montant = parseInt(document.getElementById("kpro-encaisser-montant").value, 10) || 0;
          const motif = document.getElementById("kpro-encaisser-motif").value.trim();
          msg.textContent = "";
          if (montant < 100 || montant > 1000000) {
            msg.textContent = "Le montant doit être compris entre 100 et 1 000 000 FCFA.";
            return;
          }
          btn.disabled = true;
          try {
            const patientId = await kproResolvePatientId({
              phone,
              knownId: kproSelectedPatient?.id,
            });
            if (patientId == null) {
              msg.textContent = "Aucun patient trouvé pour le numéro " + phone + ".";
              return;
            }
            const result = await kproEncaisser(patientId, montant, motif);
            const tx = result.transaction && typeof result.transaction === "object" ? result.transaction : result;
            const reference = tx.reference || result.reference || "—";
            const statut = tx.statut || result.statut || "en_attente";
            msg.textContent = `Demande d'encaissement créée — Référence : ${reference} · Statut : ${statut}` +
              (result.message ? " · " + result.message : "");
            form.reset();
            renderSolde();
          } catch (err) {
            msg.textContent = err.message || "Impossible de créer la demande d'encaissement.";
          } finally {
            btn.disabled = false;
          }
        });
      }

      // ── Helpers ──
      function escapeHtml(str) {
        return String(str ?? "").replace(/[&<>"']/g, (c) => ({
          "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
        }[c]));
      }

      // ── Exports ──
      window.kpro = {
        login: kproLogin,
        loginSilent: kproLoginSilent,
        logout: kproLogout,
        hasSession: kproHasSession,
        fetch: kproFetch,
        patients: kproPatients,
        patientDetail: kproPatientDetail,
        factures: kproFactures,
        ordonnances: kproOrdonnances,
        saveFacture: kproSaveFacture,
        saveOrdonnance: kproSaveOrdonnance,
        solde: kproSolde,
        encaisser: kproEncaisser,
        resolvePatientId: kproResolvePatientId,
        isDemoMoney: kproIsDemoMoney,
        refreshAll: () => { loadPatients(); renderFactures(); renderOrdonnances(); renderSolde(); },
      };

      // ── Init ──
      kproBindSessionForm();
      kproBindSubnav();
      kproBindFactureForm();
      kproBindOrdonnanceForm();
      kproBindEncaisserForm();
      populateActesList();
      kproAddMedicament(); // premier bloc de prescription
      if (patientSearchEl) {
        let debounce;
        patientSearchEl.addEventListener("input", () => {
          clearTimeout(debounce);
          debounce = setTimeout(loadPatients, 300);
        });
      }
      kproShowSessionBanner();
      if (kproHasSession()) {
        loadPatients();
        renderFactures();
        renderOrdonnances();
        renderSolde();
      }
    })();