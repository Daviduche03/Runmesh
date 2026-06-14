(function () {
  const pg = window.ConnectPlayground;

  function $(id) {
    return document.getElementById(id);
  }

  function logTo(app, message, isError) {
    const el = $(`log-${app}`);
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("error", Boolean(isError));
  }

  function shortId(value) {
    if (!value) return "—";
    if (value.length <= 16) return value;
    return `${value.slice(0, 8)}…${value.slice(-4)}`;
  }

  function renderStatus(app) {
    const state = pg.getAppState(app);
    $(`status-app-${app}`).textContent = shortId(state.appId);
    $(`status-external-${app}`).textContent = state.externalUserId || "—";
    $(`status-user-${app}`).textContent = shortId(state.connectUserId);
    $(`status-challenge-${app}`).textContent = shortId(state.challengeId);
    const uri = pg.redirectUri(app);
    const redirectEl = $(`status-redirect-${app}`);
    redirectEl.textContent = uri;
    const mismatch = state.appId ? pg.redirectUriError(state.appId, uri) : null;
    redirectEl.classList.toggle("warning", Boolean(mismatch));
    const warnEl = $(`redirect-warn-${app}`);
    if (warnEl) {
      warnEl.textContent = mismatch || "";
      warnEl.hidden = !mismatch;
    }
    const record = state.appId ? pg.getAppRecord(state.appId) : null;
    const allowedEl = $(`status-allowed-${app}`);
    if (allowedEl) {
      allowedEl.textContent = record?.redirect_uris?.join(", ") || "—";
    }
    $(`input-app-${app}`).value = state.appId;
    $(`input-external-${app}`).value = state.externalUserId;
    $(`input-email-${app}`).value = state.email;
    $(`input-scopes-${app}`).value = state.scopes;
    updateButtons(app);
    updateIdentityBanner();
  }

  function updateButtons(app) {
    const state = pg.getAppState(app);
    const hasUser = Boolean(state.connectUserId);
    const hasChallenge = Boolean(state.challengeId);
    $(`btn-connect-${app}`).disabled = !hasUser;
    $(`btn-grant-${app}`).disabled = !hasUser;
    $(`btn-verify-${app}`).disabled = !hasChallenge;
    $(`btn-resend-${app}`).disabled = !hasChallenge;
    $(`btn-grants-${app}`).disabled = !state.appId;
  }

  function updateIdentityBanner() {
    const a = pg.getAppState("a").connectUserId;
    const b = pg.getAppState("b").connectUserId;
    const banner = $("identity-banner");
    if (!banner) return;
    banner.classList.remove("match", "mismatch", "pending");
    if (!a && !b) {
      banner.textContent = "Authenticate in both apps with the same email to verify portable identity.";
      banner.classList.add("pending");
      return;
    }
    if (!a || !b) {
      banner.textContent = `One app authenticated (${shortId(a || b)}). Authenticate the other app with the same email.`;
      banner.classList.add("pending");
      return;
    }
    if (a === b) {
      banner.textContent = `Portable identity confirmed — both apps share connect_user_id ${a}`;
      banner.classList.add("match");
      return;
    }
    banner.textContent = `Mismatch — App A: ${a} · App B: ${b}`;
    banner.classList.add("mismatch");
  }

  async function runAction(app, action) {
    try {
      let result;
      if (action === "otp") {
        result = await pg.createAuthenticateSession(app, $(`input-email-${app}`).value);
        logTo(app, `OTP sent\n${pg.formatJson(result)}`);
      } else if (action === "verify") {
        result = await pg.verifyOtp(app, $(`input-otp-${app}`).value);
        logTo(app, `Verified\n${pg.formatJson(result)}`);
      } else if (action === "resend") {
        result = await pg.resendOtp(app);
        logTo(app, `OTP resent\n${pg.formatJson(result)}`);
      } else if (action === "connect" || action === "grant") {
        result = await pg.createOAuthSession(app, action);
        logTo(app, `Opening authorize URL (${action})\n${pg.formatJson(result)}`);
        if (result.authorize_url) {
          window.location.href = result.authorize_url;
        }
      } else if (action === "grants") {
        const state = pg.getAppState(app);
        result = await pg.listAppGrants(state.appId);
        logTo(app, `Grants\n${pg.formatJson(result)}`);
      }
      renderStatus(app);
      return result;
    } catch (err) {
      logTo(app, err instanceof Error ? err.message : "Something went wrong", true);
      throw err;
    }
  }

  function bindApp(app) {
    $(`input-app-${app}`).addEventListener("change", (e) => {
      pg.saveAppState(app, { appId: e.target.value.trim() });
      renderStatus(app);
    });
    $(`input-external-${app}`).addEventListener("change", (e) => {
      pg.saveAppState(app, { externalUserId: e.target.value.trim() });
      renderStatus(app);
    });
    $(`input-email-${app}`).addEventListener("change", (e) => {
      pg.saveAppState(app, { email: e.target.value.trim() });
    });
    $(`input-scopes-${app}`).addEventListener("change", (e) => {
      pg.saveAppState(app, { scopes: e.target.value.trim() });
    });
    $(`btn-otp-${app}`).addEventListener("click", () => runAction(app, "otp"));
    $(`btn-verify-${app}`).addEventListener("click", () => runAction(app, "verify"));
    $(`btn-resend-${app}`).addEventListener("click", () => runAction(app, "resend"));
    $(`btn-connect-${app}`).addEventListener("click", () => runAction(app, "connect"));
    $(`btn-grant-${app}`).addEventListener("click", () => runAction(app, "grant"));
    $(`btn-grants-${app}`).addEventListener("click", () => runAction(app, "grants"));
    $(`btn-clear-${app}`).addEventListener("click", () => {
      localStorage.removeItem(`connect-playground-${app}`);
      $(`input-otp-${app}`).value = "";
      logTo(app, "");
      renderStatus(app);
    });
    renderStatus(app);
  }

  async function initSetup() {
    $("input-api-base").value = pg.getApiBase();
    $("input-token").value = localStorage.getItem(pg.STORAGE.TOKEN) || "";

    $("input-api-base").addEventListener("change", (e) => {
      pg.setApiBase(e.target.value);
    });

    $("input-token").addEventListener("change", (e) => {
      pg.setToken(e.target.value);
    });

    $("btn-use-dashboard-token").addEventListener("click", () => {
      const token = localStorage.getItem("runmesh-token") || "";
      $("input-token").value = token;
      pg.setToken(token);
      $("setup-status").textContent = token ? "Using dashboard token from localStorage." : "No runmesh-token found. Log into the dashboard first.";
    });

    $("btn-create-apps").addEventListener("click", async () => {
      $("setup-status").textContent = "Creating apps…";
      try {
        const { appA, appB } = await pg.createPlaygroundApps();
        $("setup-status").textContent = `Created App A (${appA.id}) and App B (${appB.id}). Register redirect URIs are set automatically.`;
        renderStatus("a");
        renderStatus("b");
        await refreshAppSelects();
      } catch (err) {
        $("setup-status").textContent = err instanceof Error ? err.message : "Failed to create apps";
      }
    });

    $("btn-load-apps").addEventListener("click", refreshAppSelects);

    $("select-app-a").addEventListener("change", (e) => {
      if (e.target.value) {
        pg.saveAppState("a", { appId: e.target.value });
        renderStatus("a");
      }
    });

    $("select-app-b").addEventListener("change", (e) => {
      if (e.target.value) {
        pg.saveAppState("b", { appId: e.target.value });
        renderStatus("b");
      }
    });
  }

  async function refreshAppSelects() {
    try {
      const apps = await pg.listConnectApps();
      const options = apps
        .map((app) => `<option value="${app.id}">${app.name} (${app.slug})</option>`)
        .join("");
      $("select-app-a").innerHTML = `<option value="">Select existing app…</option>${options}`;
      $("select-app-b").innerHTML = `<option value="">Select existing app…</option>${options}`;
      const stateA = pg.getAppState("a");
      const stateB = pg.getAppState("b");
      if (stateA.appId) $("select-app-a").value = stateA.appId;
      if (stateB.appId) $("select-app-b").value = stateB.appId;
      $("setup-status").textContent = `Loaded ${apps.length} connect app(s).`;
      renderStatus("a");
      renderStatus("b");
    } catch (err) {
      $("setup-status").textContent = err instanceof Error ? err.message : "Failed to load apps";
    }
  }

  bindApp("a");
  bindApp("b");
  initSetup();
  if (pg.getToken()) {
    refreshAppSelects();
  }
})();
