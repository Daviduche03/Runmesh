import { definitionFingerprint } from "./fingerprint.js";
import type {
  AgentDefinition,
  ClientOptions,
  ForwardOutcome,
  InvokeOutcome,
  ResolvedAgent,
  RunInfo,
  RunStatus,
  TelemetryEvent,
  ToolManifestEntry,
  ToolRegistration,
  ToolWarning,
} from "./types.js";

type AgnosticFetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Thin client over the Runmesh collection API. Telemetry transport must
 * never break the agent: `record()` and `flush()` never throw. `resolve`,
 * `start`, and `finish` throw on transport failure so a dead pipeline is
 * loud at setup, not silent in production.
 */
export class RunmeshClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly batchSize: number;
  private readonly onError: (err: unknown) => void;
  private readonly fetchImpl: AgnosticFetch;
  private buffer: TelemetryEvent[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(options: ClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.batchSize = options.batchSize ?? 50;
    this.onError = options.onError ?? (() => {});
    this.fetchImpl = (options.fetchImpl ?? globalThis.fetch) as AgnosticFetch;
    const interval = options.flushIntervalMs ?? 2000;
    if (interval > 0) {
      this.timer = setInterval(() => {
        void this.flush().catch(() => {});
      }, interval);
      if (typeof this.timer === "object" && "unref" in this.timer) {
        (this.timer as { unref(): void }).unref();
      }
    }
  }

  private async request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    headers["Authorization"] = "Bearer " + this.apiKey;
    headers["Content-Type"] = "application" + "/" + "json";
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.fetchImpl(this.endpoint + path, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Runmesh ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  /** Resolve a definition to a canonical agent. Opens a new version when
   *  the fingerprint changed. Computes the fingerprint locally when omitted. */
  async resolveAgent(def: AgentDefinition): Promise<ResolvedAgent> {
    const tools: ToolManifestEntry[] | undefined = def.tools;
    const fingerprint = def.fingerprint ?? definitionFingerprint(def);
    const data = await this.request<{ data: Record<string, unknown> }>(
      "/api/v1/agents:resolve",
      "PUT",
      {
        external_key: def.externalKey ?? null,
        fingerprint,
        name: def.name ?? null,
        framework: def.framework ?? null,
        model: def.model ?? null,
        system_prompt: def.systemPrompt ?? null,
        tools: tools ?? null,
      },
    );
    const row = data.data;
    const rawTools = Array.isArray(row["tools"]) ? (row["tools"] as Record<string, unknown>[]) : [];
    return {
      id: String(row["id"]),
      version: Number(row["version"] ?? 1),
      isNew: row["is_new"] === true,
      isNewVersion: row["is_new_version"] === true,
      framework: (row["framework"] as string | null) ?? null,
      model: (row["model"] as string | null) ?? null,
      tools: rawTools.map((tool): ToolRegistration => ({
        name: String(tool["name"]),
        ref: String(tool["ref"]),
        kind: tool["kind"] === "managed" ? "managed" : "local",
        provider: (tool["provider"] as string | null) ?? null,
        action: String(tool["action"] ?? ""),
      })),
      warnings: (Array.isArray(row["tool_warnings"]) ? (row["tool_warnings"] as Record<string, unknown>[]) : []).map(
        (warning): ToolWarning => ({
          tool: String(warning["tool"] ?? ""),
          code: String(warning["code"] ?? ""),
          message: String(warning["message"] ?? ""),
        }),
      ),
    };
  }

  /**
   * Execute a managed tool. Policy decides server-side; on allow, Runmesh
   * injects the connection credential and returns only the result. Denials
   * and pending states come back as values, not exceptions.
   */
  async invoke(
    ref: string,
    args: unknown,
    opts: { runId: string; idempotencyKey?: string; connectUserId?: string },
  ): Promise<InvokeOutcome> {
    const data = await this.request<{ data: Record<string, unknown> }>(
      `/api/v1/tools/${encodeURIComponent(ref)}/invoke`,
      "POST",
      {
        run_id: opts.runId,
        args: args ?? {},
        idempotency_key: opts.idempotencyKey ?? null,
        connect_user_id: opts.connectUserId ?? null,
      },
    );
    const row = data.data;
    const decision = String(row["decision"] ?? "");
    if (decision === "allow") {
      return {
        decision: "allow",
        status: Number(row["status"] ?? 200),
        result: row["result"],
        upstreamError: row["upstream_error"] === true,
      };
    }
    if (decision === "deny") {
      return {
        decision: "deny",
        reason: String(row["reason"] ?? "Denied by policy"),
        rule: (row["rule"] as string | null) ?? null,
      };
    }
    if (decision === "escalate") {
      return {
        decision: "escalate",
        reason: String(row["reason"] ?? "Requires approval"),
        rule: (row["rule"] as string | null) ?? null,
      };
    }
    if (decision === "consent") {
      return {
        decision: "consent",
        provider: (row["provider"] as string | null) ?? null,
        reason: String(row["reason"] ?? "Consent required"),
      };
    }
    return { decision: "deny", reason: `Unknown decision: ${decision}` };
  }

  /**
   * Forward the caller's own request through Runmesh. The host is fixed by
   * the tool's registered base URL; only the path is passed. The credential
   * is injected server-side and never returned.
   */
  async forward(
    ref: string,
    request: {
      method?: string;
      path: string;
      headers?: Record<string, string>;
      body?: unknown;
      query?: Record<string, unknown>;
    },
    opts: { runId: string; idempotencyKey?: string; connectUserId?: string },
  ): Promise<ForwardOutcome> {
    const data = await this.request<{ data: Record<string, unknown> }>(
      `/api/v1/tools/${encodeURIComponent(ref)}/forward`,
      "POST",
      {
        run_id: opts.runId,
        method: request.method ?? "GET",
        path: request.path,
        headers: request.headers ?? null,
        body: request.body ?? null,
        query: request.query ?? null,
        idempotency_key: opts.idempotencyKey ?? null,
        connect_user_id: opts.connectUserId ?? null,
      },
    );
    const row = data.data;
    const decision = String(row["decision"] ?? "");
    if (decision === "allow") {
      return {
        decision: "allow",
        status: Number(row["status"] ?? 200),
        text: String(row["body"] ?? ""),
        upstreamError: row["upstream_error"] === true,
      };
    }
    if (decision === "consent") {
      return {
        decision: "consent",
        provider: (row["provider"] as string | null) ?? null,
        reason: String(row["reason"] ?? "Consent required"),
      };
    }
    return {
      decision: decision === "escalate" ? "escalate" : "deny",
      reason: String(row["reason"] ?? "Denied by policy"),
      rule: (row["rule"] as string | null) ?? null,
    };
  }

  async startRun(input: {
    agentId: string;
    parentRunId?: string | undefined;
    input?: string | undefined;
    connectUserId?: string | undefined;
  }): Promise<RunInfo> {
    const data = await this.request<{ data: Record<string, unknown> }>("/api/v1/runs", "POST", {
      agent_id: input.agentId,
      parent_run_id: input.parentRunId ?? null,
      input: input.input ?? null,
      connect_user_id: input.connectUserId ?? null,
    });
    const row = data.data;
    return {
      id: String(row["id"]),
      agentId: String(row["agent_id"]),
      parentRunId: (row["parent_run_id"] as string | null) ?? null,
      status: String(row["status"]),
    };
  }

  async finishRun(
    runId: string,
    outcome?: { status?: RunStatus | undefined; usage?: Record<string, unknown> | undefined },
  ): Promise<void> {
    await this.request(`/api/v1/runs/${runId}/finish`, "POST", {
      status: outcome?.status ?? "completed",
      usage: outcome?.usage ?? {},
    });
  }

  /** Buffer an event. Never throws. */
  record(event: TelemetryEvent): void {
    try {
      this.buffer.push(event);
      if (this.buffer.length >= this.batchSize) {
        void this.flush().catch(() => {});
      }
    } catch (err) {
      this.onError(err);
    }
  }

  /** Flush the buffer. Never throws; transport errors go to onError. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      // The API speaks snake_case; the SDK surface stays camelCase.
      await this.request("/api/v1/ingest", "POST", {
        events: batch.map((event) => ({
          run_id: event.runId,
          kind: event.kind,
          name: event.name ?? "",
          args: event.args ?? {},
          result: event.result ?? {},
          duration_ms: event.durationMs ?? null,
        })),
      });
    } catch (err) {
      this.onError(err);
    }
  }

  /** Flush and stop the background timer. */
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}
