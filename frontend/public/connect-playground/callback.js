(function () {
  const pg = window.ConnectPlayground;
  const app = window.PLAYGROUND_APP;

  function $(id) {
    return document.getElementById(id);
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");
    const state = params.get("state");
    const title = $("callback-title");
    const summary = $("callback-summary");
    const log = $("callback-log");

    if (error) {
      title.textContent = "Connect failed";
      summary.textContent = `OAuth returned error: ${error}`;
      log.textContent = pg.formatJson({ error, state });
      return;
    }

    if (!code) {
      title.textContent = "No code received";
      summary.textContent = "Expected a code query parameter from Runmesh Connect.";
      log.textContent = pg.formatJson(Object.fromEntries(params.entries()));
      return;
    }

    const appState = pg.getAppState(app);
    if (!appState.appId) {
      title.textContent = "Missing app configuration";
      summary.textContent = "Set the app ID on the playground page before completing OAuth.";
      log.textContent = pg.formatJson({ code, state });
      return;
    }

    title.textContent = "Exchanging code…";
    summary.textContent = `Finishing ${app === "a" ? "TaskFlow" : "NotePad"} callback.`;

    try {
      const result = await pg.exchangeToken(appState.appId, code);
      if (result.connect_user_id) {
        pg.saveAppState(app, { connectUserId: result.connect_user_id });
      }
      title.textContent = "Connect succeeded";
      summary.textContent = `Mode: ${result.mode || "unknown"} · connect_user_id: ${result.connect_user_id || "—"}`;
      log.textContent = pg.formatJson(result);
    } catch (err) {
      title.textContent = "Token exchange failed";
      summary.textContent = err instanceof Error ? err.message : "Request failed";
      log.textContent = pg.formatJson({ code, state });
    }
  }

  init();
})();
