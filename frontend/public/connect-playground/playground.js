window.ConnectPlayground = (() => {
  const STORAGE = {
    API_BASE: "connect-playground-api-base",
    TOKEN: "connect-playground-token",
  };

  const DEFAULT_SCOPES = ["gmail.readonly", "drive.readonly"];

  let appsCache = [];

  function getApiBase() {
    return localStorage.getItem(STORAGE.API_BASE) || "http://localhost:8787";
  }

  function setApiBase(value) {
    localStorage.setItem(STORAGE.API_BASE, value.trim());
  }

  function getToken() {
    return localStorage.getItem("runmesh-token") || localStorage.getItem(STORAGE.TOKEN) || "";
  }

  function setToken(value) {
    if (value.trim()) {
      localStorage.setItem(STORAGE.TOKEN, value.trim());
    } else {
      localStorage.removeItem(STORAGE.TOKEN);
    }
  }

  function appKey(app) {
    return `connect-playground-${app}`;
  }

  function defaultAppState(app) {
    return {
      appId: "",
      externalUserId: app === "a" ? "user_a_playground" : "user_b_playground",
      email: "",
      connectUserId: "",
      challengeId: "",
      scopes: DEFAULT_SCOPES.join(", "),
    };
  }

  function getAppState(app) {
    const defaults = defaultAppState(app);
    const raw = localStorage.getItem(appKey(app));
    if (!raw) {
      return defaults;
    }
    try {
      return { ...defaults, ...JSON.parse(raw) };
    } catch {
      return defaults;
    }
  }

  function saveAppState(app, patch) {
    const next = { ...getAppState(app), ...patch };
    localStorage.setItem(appKey(app), JSON.stringify(next));
    return next;
  }

  function redirectUri(app) {
    return `${window.location.origin}/connect-playground/callback-${app}.html`;
  }

  function redirectUriCandidates(app) {
    const path = `/connect-playground/callback-${app}.html`;
    const { protocol, port } = window.location;
    const hosts = new Set([window.location.hostname]);
    if (hosts.has("localhost")) {
      hosts.add("127.0.0.1");
    }
    if (hosts.has("127.0.0.1")) {
      hosts.add("localhost");
    }
    const portPart = port ? `:${port}` : "";
    return [...hosts].map((host) => `${protocol}//${host}${portPart}${path}`);
  }

  function getAppRecord(appId) {
    return appsCache.find((entry) => entry.id === appId);
  }

  function redirectUriError(appId, uri) {
    const record = getAppRecord(appId);
    if (!record) {
      return null;
    }
    if (record.redirect_uris.includes(uri)) {
      return null;
    }
    const allowed = record.redirect_uris.length
      ? record.redirect_uris.join("\n")
      : "(none registered)";
    return `redirect_uri is not allowed for this app.\n\nPlayground sends:\n${uri}\n\nThis app allows:\n${allowed}\n\nUse "Create demo apps" on this exact URL, or add the playground callback URL in Settings → Connect.`;
  }

  function ensureRedirectAllowed(appId, uri) {
    const message = redirectUriError(appId, uri);
    if (message) {
      throw new Error(message);
    }
  }

  async function apiRequest(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (!token) {
      throw new Error("Developer token required. Log into the dashboard or paste a JWT.");
    }
    headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${getApiBase()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) {
      const message =
        payload.error?.message ||
        (typeof payload.detail === "string" ? payload.detail : null) ||
        "Request failed";
      throw new Error(message);
    }
    return payload;
  }

  async function listConnectApps() {
    const payload = await apiRequest("GET", "/api/v1/connect/apps");
    appsCache = payload.data || [];
    return appsCache;
  }

  async function createConnectApp(name, slug, redirectUris) {
    const payload = await apiRequest("POST", "/api/v1/connect/apps", {
      name,
      slug,
      redirect_uris: redirectUris,
      allowed_providers: ["google"],
    });
    return payload.data;
  }

  async function createPlaygroundApps() {
    const stamp = Date.now().toString(36);
    const appA = await createConnectApp(
      "Playground TaskFlow",
      `playground-taskflow-${stamp}`,
      redirectUriCandidates("a")
    );
    const appB = await createConnectApp(
      "Playground NotePad",
      `playground-notepad-${stamp}`,
      redirectUriCandidates("b")
    );
    saveAppState("a", { appId: appA.id });
    saveAppState("b", { appId: appB.id });
    return { appA, appB };
  }

  async function createAuthenticateSession(app, email) {
    const state = getAppState(app);
    if (!state.appId) {
      throw new Error("App ID is required");
    }
    if (!email.trim()) {
      throw new Error("Email is required");
    }
    const uri = redirectUri(app);
    ensureRedirectAllowed(state.appId, uri);
    const payload = await apiRequest("POST", "/api/v1/connect/sessions", {
      app_id: state.appId,
      external_user_id: state.externalUserId,
      mode: "authenticate",
      email: email.trim(),
      redirect_uri: uri,
    });
    const session = payload.data;
    saveAppState(app, {
      email: email.trim(),
      challengeId: session.challenge_id || "",
    });
    return session;
  }

  async function verifyOtp(app, code) {
    const state = getAppState(app);
    if (!state.challengeId) {
      throw new Error("Send OTP first");
    }
    const payload = await apiRequest("POST", "/api/v1/connect/otp/verify", {
      challenge_id: state.challengeId,
      code: code.trim(),
    });
    const data = payload.data;
    saveAppState(app, {
      connectUserId: data.connect_user_id || "",
      challengeId: "",
    });
    return data;
  }

  async function resendOtp(app) {
    const state = getAppState(app);
    if (!state.challengeId) {
      throw new Error("No active challenge");
    }
    const payload = await apiRequest("POST", "/api/v1/connect/otp/resend", {
      challenge_id: state.challengeId,
    });
    return payload.data;
  }

  function parseScopes(value) {
    return value
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  async function createOAuthSession(app, mode) {
    const state = getAppState(app);
    if (!state.appId) {
      throw new Error("App ID is required");
    }
    if (!state.connectUserId) {
      throw new Error("Authenticate first to get connect_user_id");
    }
    const scopes = parseScopes(state.scopes);
    if (mode === "connect" && scopes.length === 0) {
      throw new Error("At least one scope is required for connect");
    }
    const uri = redirectUri(app);
    ensureRedirectAllowed(state.appId, uri);
    const payload = await apiRequest("POST", "/api/v1/connect/sessions", {
      app_id: state.appId,
      external_user_id: state.externalUserId,
      connect_user_id: state.connectUserId,
      mode,
      provider: "google",
      scopes,
      redirect_uri: uri,
    });
    return payload.data;
  }

  async function exchangeToken(appId, code) {
    const payload = await apiRequest("POST", "/api/v1/connect/token", {
      app_id: appId,
      code,
    });
    return payload.data;
  }

  async function listAppGrants(appId) {
    const payload = await apiRequest("GET", `/api/v1/connect/apps/${appId}/grants`);
    return payload.data || [];
  }

  function formatJson(value) {
    return JSON.stringify(value, null, 2);
  }

  return {
    STORAGE,
    DEFAULT_SCOPES,
    getApiBase,
    setApiBase,
    getToken,
    setToken,
    getAppState,
    saveAppState,
    redirectUri,
    redirectUriError,
    getAppRecord,
    listConnectApps,
    createPlaygroundApps,
    createAuthenticateSession,
    verifyOtp,
    resendOtp,
    createOAuthSession,
    exchangeToken,
    listAppGrants,
    formatJson,
  };
})();
