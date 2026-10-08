(() => {
  const list = document.getElementById("settings-devices");
  const settingsButton = document.getElementById("btn-settings");
  if (!list || !settingsButton) return;

  async function loadDevices() {
    list.replaceChildren();
    const loading = document.createElement("li");
    loading.className = "settings-device-meta";
    loading.textContent = "Chargement des appareils…";
    list.appendChild(loading);

    try {
      const base = serverUrl.replace(/\/+$/, "");
      const response = await window.fetchAuth(base + apiPrefix() + "/devices");
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message || `Erreur serveur (${response.status}).`);
      }

      list.replaceChildren();
      const devices = data.devices || [];
      if (devices.length === 0) {
        const empty = document.createElement("li");
        empty.className = "settings-device-meta";
        empty.textContent = "Aucun appareil enregistré.";
        list.appendChild(empty);
        return;
      }

      devices.forEach((device) => {
        const item = document.createElement("li");
        item.className = "settings-device";
        const info = document.createElement("span");
        info.className = "settings-device-info";
        const name = document.createElement("strong");
        name.textContent = device.label || device.platform || "Appareil";
        const details = document.createElement("span");
        details.className = "settings-device-meta";
        details.textContent = `${device.platform || "web"} · ${device.device_id || ""}`;
        info.append(name, details);
        item.appendChild(info);

        if (device.device_id === myDeviceId) {
          const current = document.createElement("span");
          current.className = "settings-device-meta";
          current.textContent = "Cet appareil";
          item.appendChild(current);
        } else {
          const remove = document.createElement("button");
          remove.className = "btn-text";
          remove.type = "button";
          remove.textContent = "Retirer";
          remove.addEventListener("click", () => removeDevice(device.device_id, remove));
          item.appendChild(remove);
        }
        list.appendChild(item);
      });
    } catch (error) {
      list.replaceChildren();
      const failure = document.createElement("li");
      failure.className = "settings-device-meta";
      failure.textContent = error.message || "Impossible de charger les appareils.";
      list.appendChild(failure);
    }
  }

  async function removeDevice(deviceId, button) {
    button.disabled = true;
    try {
      const base = serverUrl.replace(/\/+$/, "");
      const response = await window.fetchAuth(
        base + apiPrefix() + "/devices/" + encodeURIComponent(deviceId),
        { method: "DELETE" }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message || `Erreur serveur (${response.status}).`);
      }
      await loadDevices();
    } catch (error) {
      button.disabled = false;
      window.alert(error.message || "Impossible de retirer cet appareil.");
    }
  }

  settingsButton.addEventListener("click", loadDevices);
})();
