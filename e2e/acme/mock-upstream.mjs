// Mock upstream for the Acme E2E. Records every call (including the
// Authorization header the Runmesh worker injects) and echoes it back in the
// response body so the suite can prove server-side scrubbing. No network egress.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 8799);

/** @type {{method: string, path: string, auth: string | null, body: unknown}[]} */
let hits = [];
/** Paths that should answer 500 for the failure leg. */
let failPaths = new Set();

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
    send(res, 200, { ok: true });
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
