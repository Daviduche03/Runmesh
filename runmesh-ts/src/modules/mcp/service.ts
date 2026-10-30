/**
 * The MCP server. This is the primary surface: every coding agent that speaks MCP —
 * Claude Code, Codex, OpenCode — connects here, and every call runs through the same
 * policy, credential injection, and ledger as the dashboard's own tool path.
 *
 * Transport only. Decisions happen inside `invokeTool`; this module translates between
 * JSON-RPC and the service layer and maps decisions onto MCP's `isError` convention.
 * No SDK dependency: the five methods agents actually use are small enough to speak
 * directly, and every response is shaped so a client can never receive our HTML error
 * page where it expects JSON-RPC.
 */
import type { Db } from "../../core/db/client.js";
import { ensureSessionRun } from "../hooks/service.js";
import { invokeTool, listTools } from "../tools/index.js";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "runmesh", version: "0.1.0" };

export const LIST_TOOLS_NAME = "runmesh_list_tools";
export const CALL_TOOL_NAME = "runmesh_call_tool";

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

export interface McpOutcome {
  httpStatus: number;
  payload: unknown;
}

function paramsObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function record(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function result(id: string | number | null, data: unknown): McpOutcome {
  return { httpStatus: 200, payload: { jsonrpc: "2.0", id, result: data } };
}

function failure(
  id: string | number | null,
  code: number,
  message: string,
  httpStatus = 200,
): McpOutcome {
  return { httpStatus, payload: { jsonrpc: "2.0", id, error: { code, message } } };
}

function negotiatedVersion(client: unknown): string {
  return typeof client === "string" && PROTOCOL_VERSIONS.includes(client)
    ? client
    : PROTOCOL_VERSIONS[0]!;
}

function toolDescriptions(): Array<Record<string, unknown>> {
  return [
    {
      name: LIST_TOOLS_NAME,
      description:
        "List the managed tools this workspace exposes. Call this first to discover tool_ref values.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: CALL_TOOL_NAME,
      description:
        "Run a managed tool through Runmesh policy. The call is decided, executed with the stored credential, and recorded. A refusal comes back as isError with the reason.",
      inputSchema: {
        type: "object",
        properties: {
          tool_ref: { type: "string", description: "Tool id from runmesh_list_tools." },
          args: { type: "object", description: "Arguments forwarded to the tool." },
          run_id: {
            type: "string",
            description: "Existing run to attach to. Omit to use session_id.",
          },
          session_id: {
            type: "string",
            description:
              "Stable caller-chosen session id. Reuse it across calls so they share one run.",
          },
          idempotency_key: { type: "string", description: "Safe retry key." },
        },
        required: ["tool_ref"],
        additionalProperties: false,
      },
    },
  ];
}

function isErrorText(decision: unknown, reason: unknown, consentUrl: unknown): string {
  const text = typeof reason === "string" && reason ? reason : `Call ${String(decision)}.`;
  if (decision === "escalate") return `Requires a human before this runs: ${text}`;
  if (decision === "consent") {
    const url = typeof consentUrl === "string" && consentUrl ? ` Consent: ${consentUrl}` : "";
    return `${text}${url}`;
  }
  return text;
}

async function callTool(
  db: Db,
  userId: string,
  workspaceId: string,
  id: string | number | null,
  args: unknown,
): Promise<McpOutcome> {
  const fields = record(args);
  const toolRef = str(fields?.["tool_ref"]).trim();
  if (!toolRef) {
    return failure(id, -32602, "tool_ref is required");
  }

  const callArgs = record(fields?.["args"]) ?? {};
  const runIdRaw = str(fields?.["run_id"]).trim();
  const sessionId = str(fields?.["session_id"]).trim();
  const idempotencyKey = str(fields?.["idempotency_key"]).trim() || undefined;

  let runId = runIdRaw;
  if (!runId) {
    runId = ensureSessionRun(db, userId, workspaceId, "mcp", sessionId).runId;
  }

  let outcome: Record<string, unknown>;
  try {
    outcome = await invokeTool(db, {
      userId,
      workspaceId,
      ref: toolRef,
      runId,
      args: callArgs,
      idempotencyKey,
    });
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    const message = err instanceof Error ? err.message : "Tool call failed.";
    if (typeof status === "number" && status < 500) return failure(id, -32602, message);
    return failure(id, -32603, "Internal error.");
  }

  if (outcome["decision"] !== "allow") {
    return result(id, {
      content: [
        {
          type: "text",
          text: isErrorText(outcome["decision"], outcome["reason"], outcome["consent_url"]),
        },
      ],
      isError: true,
      _meta: { run_id: runId },
    });
  }

  return result(id, {
    content: [{ type: "text", text: JSON.stringify(outcome) }],
    _meta: { run_id: runId },
  });
}

async function handleOne(
  db: Db,
  userId: string,
  workspaceId: string,
  body: unknown,
): Promise<McpOutcome | null> {
  const message = record(body);
  if (!message || message["jsonrpc"] !== "2.0" || typeof message["method"] !== "string") {
    return failure(
      message && ("id" in message) && (typeof message["id"] === "string" || typeof message["id"] === "number")
        ? (message["id"] as string | number)
        : null,
      -32600,
      "Invalid request.",
    );
  }

  const id =
    typeof message["id"] === "string" || typeof message["id"] === "number"
      ? message["id"]
      : null;
  const method = message["method"] as string;
  const params = paramsObject(message["params"]);

  if (method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: negotiatedVersion(params["protocolVersion"]),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: toolDescriptions() });
    case "tools/call": {
      const name = str(params["name"]).trim();
      if (name === LIST_TOOLS_NAME) {
        const items = listTools(db, userId, workspaceId);
        return result(id, {
          content: [{ type: "text", text: JSON.stringify(items) }],
        });
      }
      if (name === CALL_TOOL_NAME) {
        return callTool(db, userId, workspaceId, id, params["arguments"]);
      }
      return failure(id, -32602, `Unknown tool: ${name || "(missing)"}.`);
    }
    default:
      return failure(id, -32601, `Method not found: ${method}.`);
  }
}

/**
 * One JSON-RPC request or batch. Notifications produce no entry; a batch of only
 * notifications answers 202 with no body, per the streamable HTTP spec.
 */
export async function handleMcp(
  db: Db,
  userId: string,
  workspaceId: string,
  body: unknown,
): Promise<McpOutcome> {
  if (Array.isArray(body)) {
    if (body.length === 0) return failure(null, -32600, "Invalid request.");
    const outcomes = await Promise.all(
      body.map((entry) => handleOne(db, userId, workspaceId, entry)),
    );
    const replies = outcomes
      .map((outcome) => outcome?.payload)
      .filter((payload) => payload !== undefined);
    if (replies.length === 0) return { httpStatus: 202, payload: null };
    return { httpStatus: 200, payload: replies };
  }

  const outcome = await handleOne(db, userId, workspaceId, body);
  if (outcome === null) return { httpStatus: 202, payload: null };
  return outcome;
}
