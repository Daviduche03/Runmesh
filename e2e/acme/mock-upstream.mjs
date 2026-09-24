// Mock upstream for the Acme E2E. Records every call (including the
// Authorization header the Runmesh worker injects) and echoes it back in the
// response body so the suite can prove server-side scrubbing. No network egress.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 8799);

/** @type {{method: string, path: string, auth: string | null, body: unknown}[]} */
let hits = [];
/** Paths that should answer 500 for the failure leg. */
let failPaths = new Set();
/** Tier-2 hostile-upstream controls: per-path delay ms, big-body bytes, raw text. */
let delayMs = new Map();
let bigBytes = new Map();
let rawText = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(res, status, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === "/_hits" && req.method === "GET") {
    send(res, 200, hits);
    return;
  }
  if (path === "/_reset" && req.method === "POST") {
    hits = [];
    failPaths = new Set();
    delayMs = new Map();
    bigBytes = new Map();
    rawText = new Map();
    send(res, 200, { ok: true });
    return;
  }
  if (path === "/_delay" && req.method === "POST") {
    try {
      const body = JSON.parse(raw || "{}");
      for (const [p, ms] of Object.entries(body.delays ?? {})) delayMs.set(String(p), Number(ms) || 0);
      send(res, 200, { ok: true, delays: Object.fromEntries(delayMs) });
    } catch {
      send(res, 400, { error: "bad_json" });
    }
    return;
  }
  if (path === "/_big" && req.method === "POST") {
    try {
      const body = JSON.parse(raw || "{}");
      for (const [p, n] of Object.entries(body.paths ?? {})) bigBytes.set(String(p), Number(n) || 0);
      send(res, 200, { ok: true, paths: [...bigBytes.keys()] });
    } catch {
      send(res, 400, { error: "bad_json" });
    }
    return;
  }
  if (path === "/_raw" && req.method === "POST") {
    try {
      const body = JSON.parse(raw || "{}");
      for (const [p, text] of Object.entries(body.paths ?? {})) rawText.set(String(p), String(text));
      send(res, 200, { ok: true, paths: [...rawText.keys()] });
    } catch {
      send(res, 400, { error: "bad_json" });
    }
    return;
  }
  if (path === "/_fail" && req.method === "POST") {
    try {
      const body = JSON.parse(raw || "{}");
      for (const p of body.paths ?? []) failPaths.add(String(p));
      send(res, 200, { ok: true, paths: [...failPaths] });
    } catch {
      send(res, 400, { error: "bad_json" });
    }
    return;
  }

  const auth = req.headers["authorization"] ?? null;
  let parsedBody = null;
  try {
    parsedBody = raw ? JSON.parse(raw) : null;
  } catch {
    parsedBody = raw;
  }
  hits.push({ method: req.method ?? "GET", path, auth, body: parsedBody });

  if (delayMs.has(path)) await sleep(delayMs.get(path));
  if (bigBytes.has(path)) {
    send(res, 200, {
      ok: true,
      id: `msg_${hits.length}`,
      echoAuth: auth,
      provider: "mock-upstream",
      blob: "x".repeat(Math.min(bigBytes.get(path), 8 * 1024 * 1024)),
    });
    return;
  }
  if (rawText.has(path)) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(rawText.get(path));
    return;
  }
  if (failPaths.has(path)) {
    send(res, 500, { error: "upstream_exploded", echoAuth: auth });
    return;
  }
  send(res, 200, {
    ok: true,
    id: `msg_${hits.length}`,
    echoAuth: auth,
    provider: "mock-upstream",
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-upstream listening on ${PORT}`);
});
