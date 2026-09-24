#!/usr/bin/env node
// A small but real support product: customers, subscriptions, orders, refunds,
// and a human escalation queue. Real HTTP, real state, API-key auth, real
// business rules, and fault injection so the agent can be tested under failure.
// Runmesh sits in front of it and injects the credential.
import { createServer } from "node:http";

const KEY = process.env.SUPPORT_API_KEY ?? "support_key_e2e_secret_1";
const PORT = Number(process.env.SUPPORT_PORT ?? 8791);

const CUSTOMERS = {
  cust_1: { id: "cust_1", name: "Maya Chen", email: "maya@acme.dev", plan: "Pro", subscriptionId: "sub_1" },
  cust_2: { id: "cust_2", name: "Ravi Patel", email: "ravi@acme.dev", plan: "Basic", subscriptionId: "sub_2" },
};

function freshOrders() {
  return {
    // Double-charged: two $29 charges.
    ord_1001: { id: "ord_1001", customerId: "cust_1", amount: 29, charges: [29, 29], refunded: false },
    // A single large $240 charge.
    ord_1002: { id: "ord_1002", customerId: "cust_1", amount: 240, charges: [240], refunded: false },
  };
}
function freshSubs() {
  return {
    sub_1: { id: "sub_1", customerId: "cust_1", status: "active", plan: "Pro" },
    sub_2: { id: "sub_2", customerId: "cust_2", status: "active", plan: "Basic" },
  };
}

let orders = freshOrders();
let subs = freshSubs();
let refunds = [];
let notes = [];
let escalations = [];
let faults = {}; // path -> { remaining, status }
let hits = [];
let seq = 0;

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path.startsWith("/_")) {
    if (path === "/_hits") return json(res, 200, hits);
    if (path === "/_state") {
      return json(res, 200, { orders, subs, refunds, notes, escalations });
    }
    if (path === "/_fault") {
      const body = await readBody(req);
      faults[body.path] = { remaining: Number(body.times ?? 1), status: Number(body.status ?? 503) };
      return json(res, 200, { ok: true });
    }
    if (path === "/_reset") {
      orders = freshOrders();
      subs = freshSubs();
      refunds = [];
      notes = [];
      escalations = [];
      faults = {};
      hits = [];
      seq = 0;
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: "not_found" });
  }

  const auth = req.headers["authorization"] ?? "";
  hits.push({ method: req.method, path, auth });

  if (auth !== `Bearer ${KEY}`) return json(res, 401, { error: "unauthorized" });

  // Fault injection: fail the next N calls to this path.
  const fault = faults[path];
  if (fault && fault.remaining > 0) {
    fault.remaining -= 1;
    return json(res, fault.status, { error: "upstream_unavailable" });
  }

  const body = req.method === "POST" ? await readBody(req) : {};

  if (path === "/customer" && req.method === "POST") {
    const customer = CUSTOMERS[body.customerId];
    if (!customer) return json(res, 404, { error: "customer_not_found" });
    return json(res, 200, {
      customer,
      subscription: subs[customer.subscriptionId],
      orders: Object.values(orders).filter((o) => o.customerId === customer.id),
    });
  }

  if (path === "/refund" && req.method === "POST") {
    const order = orders[body.orderId];
    if (!order) return json(res, 404, { error: "order_not_found" });
    if (order.refunded) return json(res, 409, { error: "already_refunded" });
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > order.amount) {
      return json(res, 422, { error: "invalid_amount", max: order.amount });
    }
    const idem = req.headers["idempotency-key"];
    if (idem) {
      const prior = refunds.find((r) => r.idempotencyKey === idem);
      if (prior) return json(res, 200, { ...prior, idempotent: true });
    }
    seq += 1;
    const refund = {
      id: `rf_${seq}`,
      orderId: order.id,
      customerId: order.customerId,
      amount,
      reason: body.reason ?? "",
      idempotencyKey: idem ?? null,
    };
    refunds.push(refund);
    order.refunded = true;
    return json(res, 200, refund);
  }

  if (path === "/cancel" && req.method === "POST") {
    const sub = subs[body.subscriptionId];
    if (!sub) return json(res, 404, { error: "subscription_not_found" });
    sub.status = "canceled";
    return json(res, 200, sub);
  }

  if (path === "/note" && req.method === "POST") {
    seq += 1;
    const note = { id: `nt_${seq}`, customerId: body.customerId, text: body.text ?? "" };
    notes.push(note);
    return json(res, 200, note);
  }

  if (path === "/escalate" && req.method === "POST") {
    seq += 1;
    const esc = { id: `esc_${seq}`, customerId: body.customerId, reason: body.reason ?? "" };
    escalations.push(esc);
    return json(res, 200, esc);
  }

  return json(res, 404, { error: "not_found" });
});

server.listen(PORT, () => {
  console.log(`support-backend listening on http://localhost:${PORT}`);
});
