(() => {
  const balanceEl = document.getElementById("wallet-balance");
  const walletIdEl = document.getElementById("wallet-id");
  const loadMessageEl = document.getElementById("wallet-load-message");
  const transactionsEl = document.getElementById("wallet-transactions");
  const nextPageButton = document.getElementById("wallet-next-page");
  if (!balanceEl || !transactionsEl) return;

  // Chemin relatif au préfixe de mode : apiPrefix() ajoute /api/v1 ou
  // /api/demo/v1 plus bas. Ne pas figer "/api/v1" ici.
  const walletPath = "/wallet";
  let transactionPage = 1;
  let transactionPages = 1;

  function apiBase() {
    return serverUrl.replace(/\/+$/, "") + apiPrefix();
  }

  function idempotencyKey(prefix) {
    const random = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `web-${prefix}-${random}`;
  }

  function setMessage(element, message, isError = false) {
    element.textContent = message;
    element.className = "wallet-message" + (message ? (isError ? " error" : " success") : "");
  }

  async function readJson(response) {
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const validationError = data?.errors && Object.values(data.errors)[0]?.[0];
      throw new Error(validationError || data?.error?.message || data?.message || `Erreur serveur (${response.status}).`);
    }
    return data || {};
  }

  function renderTransactions(groups, append = false) {
    if (!append) transactionsEl.replaceChildren();
    const rows = Object.entries(groups || {}).flatMap(([date, items]) =>
      items.map((item) => ({ date, item }))
    );
    if (!rows.length && !append) {
      const empty = document.createElement("li");
      empty.className = "search-empty";
      empty.textContent = "Aucune transaction pour le moment.";
      transactionsEl.appendChild(empty);
      return;
    }

    rows.forEach(({ date, item }) => {
      const li = document.createElement("li");
      li.className = "item-card wallet-transaction";

      const info = document.createElement("div");
      info.className = "item-info";
      const title = document.createElement("span");
      title.className = "item-name";
      title.textContent = item.description || item.type_name || "Transaction";
      const details = document.createElement("span");
      details.className = "item-sub";
      details.textContent = `${date} · ${item.heure_transaction || ""}`;
      const status = document.createElement("span");
      status.className = "wallet-transaction-status";
      status.textContent = item.status_show || "";
      info.append(title, details, status);

      const amount = document.createElement("span");
      amount.className = "wallet-transaction-amount";
      amount.textContent = item.amount || "";
      li.append(info, amount);
      transactionsEl.appendChild(li);
    });
  }

  async function loadTransactions(page = 1) {
    const response = await window.fetchAuth(
      `${apiBase()}${walletPath}/transactions?page=${page}&limit=20`
    );
    const data = await readJson(response);
    transactionPage = data.pagination?.page || page;
    transactionPages = data.pagination?.total_pages || 1;
    renderTransactions(data.transactions, page > 1);
    nextPageButton.hidden = transactionPage >= transactionPages;
  }

  async function refreshWallet() {
    setMessage(loadMessageEl, "");
    balanceEl.textContent = "Chargement…";
    try {
      const response = await window.fetchAuth(`${apiBase()}${walletPath}`);
      const data = await readJson(response);
      balanceEl.textContent = data.wallet?.solde || "—";
      walletIdEl.textContent = data.wallet?.wallet_id
        ? `Identifiant : ${data.wallet.wallet_id}`
        : "";
      const card = document.getElementById("solde-card");
      const amount = document.getElementById("solde-amount");
      if (card && localStorage.getItem("user_role") === "patient") {
        card.style.display = "flex";
        if (amount) amount.textContent = data.wallet?.solde || "—";
      }
      try {
        await loadTransactions(1);
      } catch (error) {
        setMessage(loadMessageEl, error.message || "Impossible de charger les transactions.", true);
      }
    } catch (error) {
      balanceEl.textContent = "Indisponible";
      setMessage(loadMessageEl, error.message || "Impossible de charger le portefeuille.", true);
    }
  }

  document.getElementById("btn-wallet-refresh").addEventListener("click", refreshWallet);
  nextPageButton.addEventListener("click", async () => {
    nextPageButton.disabled = true;
    try {
      await loadTransactions(transactionPage + 1);
    } catch (error) {
      setMessage(loadMessageEl, error.message || "Impossible de charger les transactions.", true);
    } finally {
      nextPageButton.disabled = false;
    }
  });

  document.getElementById("wallet-recharge-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById("wallet-recharge-message");
    const button = form.querySelector('button[type="submit"]');
    setMessage(message, "");
    button.disabled = true;
    try {
      const response = await window.fetchAuth(`${apiBase()}${walletPath}/recharge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey("recharge"),
        },
        body: JSON.stringify({
          montant: Number(document.getElementById("wallet-recharge-amount").value),
          phone_number: document.getElementById("wallet-recharge-phone").value.trim(),
        }),
      });
      const data = await readJson(response);
      const payment = data.information?.payment;
      if (payment?.must_be_redirected && payment.payment_url) {
        const paymentUrl = new URL(payment.payment_url, window.location.origin);
        if (paymentUrl.protocol !== "https:") {
          throw new Error("L’adresse de paiement sécurisée est invalide.");
        }
        window.location.assign(paymentUrl.href);
        return;
      }
      let confirmationMessage;
      if (payment?.mode === "demo" && isDemoMode()) {
        const reference = data.information?.reference;
        if (!reference) throw new Error("La référence de recharge est absente.");
        const confirmationResponse = await window.fetchAuth(`${apiBase()}${walletPath}/recharge/notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction_id: reference, code: 200 }),
        });
        const confirmation = await readJson(confirmationResponse);
        if (confirmation.credit !== true) {
          throw new Error("La recharge virtuelle n’a pas été confirmée.");
        }
        confirmationMessage = "Recharge de démonstration confirmée. Le solde virtuel a été crédité.";
      }
      form.reset();
      setMessage(
        message,
        confirmationMessage || (payment?.mode === "simulation"
          ? "Recharge enregistrée en attente. Le paiement sera disponible lorsque CinetPay sera configuré."
          : "Recharge initiée. Son solde sera crédité après confirmation du paiement.")
      );
      await refreshWallet();
    } catch (error) {
      setMessage(message, error.message || "Impossible d'initier la recharge.", true);
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("wallet-transfer-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById("wallet-transfer-message");
    const button = form.querySelector('button[type="submit"]');
    const recipient = document.getElementById("wallet-transfer-recipient").value.trim();
    const isWalletId = /^TGW/i.test(recipient);
    setMessage(message, "");
    button.disabled = true;
    try {
      const payload = {
        montant: Number(document.getElementById("wallet-transfer-amount").value),
      };
      payload[isWalletId ? "destinataire_wallet_id" : "phone_number"] = recipient;
      const response = await window.fetchAuth(`${apiBase()}${walletPath}/transfert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey("transfer"),
        },
        body: JSON.stringify(payload),
      });
      const data = await readJson(response);
      form.reset();
      setMessage(message, data.message || "Transfert envoyé.");
      await refreshWallet();
    } catch (error) {
      setMessage(message, error.message || "Impossible d'effectuer le transfert.", true);
    } finally {
      button.disabled = false;
    }
  });

  window.refreshWallet = refreshWallet;
})();
