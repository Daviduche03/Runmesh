/**
 * Shell command assessment.
 *
 * Bash is a dispatcher: one line can run five actions, and the interesting ones are routinely
 * hidden behind `&&`, a pipe, `$(...)`, or an interpreter. So assessment has two passes —
 * split the line into subcommands, then match each against a table. The result is a label, not
 * a verdict. Policy decides; the label only picks which rule gets asked.
 *
 * Two rules keep this honest:
 *
 * - Suspicion can only move a call toward a human. Nothing here grants permission.
 * - An unrecognised command is `unknown`, which is a normal label a rule can match. "I do not
 *   know" is never silently treated as safe.
 */

export type Suspicion = "low" | "normal" | "high" | "unknown";

export interface BashAssessment {
  /** Worst (highest-severity) action found, e.g. `git.push`, `secrets.read`. */
  action: string;
  /** Every distinct action found, in the order encountered. */
  actions: string[];
  /** Best-effort subject: a path, table, host, or branch. */
  resource: string;
  suspicion: Suspicion;
  reason: string;
  /** Evasion indicators, e.g. `encoded_payload`. */
  signals: string[];
  /** The split command, so an operator can see what we actually looked at. */
  subcommands: string[];
  /** Confidence in the rule match (rules are deterministic; unknown is not). */
  confidence: number;
}

const SEVERITY: Record<Suspicion, number> = { unknown: 0, low: 1, normal: 2, high: 3 };

/** Split on top-level `&&`, `||`, `;`, `|`, and newlines, respecting quotes and escapes. */
export function splitSubcommands(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] as string;

    if (quote !== null) {
      if (ch === "\\" && quote === '"') {
        const next = command[i + 1];
        if (next !== undefined) {
          current += ch + next;
          i += 1;
          continue;
        }
      }
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "\\") {
      const next = command[i + 1];
      current += ch + (next ?? "");
      if (next !== undefined) i += 1;
      continue;
    }

    const next = command[i + 1];
    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      parts.push(current);
      current = "";
      i += 1;
      continue;
    }
    if (ch === "|" || ch === ";" || ch === "\n") {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);

  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** `$(...)` and backtick bodies are code too. One level deep; deeper nesting is rare. */
export function extractSubstitutions(segment: string): string[] {
  const found: string[] = [];
  for (const pattern of [/\$\(([^()]*)\)/g, /`([^`]*)`/g]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(segment)) !== null) {
      const inner = (match[1] ?? "").trim();
      if (inner) found.push(inner);
    }
  }
  return found;
}

interface ActionRule {
  pattern: RegExp;
  action: string;
  suspicion: Suspicion;
  reason: string;
  resource?: (command: string, match: RegExpMatchArray) => string;
}

function firstPath(command: string, match: RegExpMatchArray): string {
  for (const group of match.slice(1)) {
    if (typeof group === "string" && group.trim() && !group.trim().startsWith("-")) {
      return group.trim();
    }
  }
  const token = command
    .split(/\s+/)
    .slice(1)
    .find((part) => part && !part.startsWith("-"));
  return token ?? "";
}

const REMOTE_TARGET = /\bgit\s+push\s+(?:-[^\s]+\s+)*(\S+)\s+(\S+)/;

/**
 * Ordered: the specific beats the general. Secrets before reads, force-push before push,
 * destroy before delete.
 */
const ACTION_RULES: ActionRule[] = [
  {
    pattern: /\b(?:bash|sh|zsh|dash)\s+-c\b|^\s*(?:python3?|node|perl|ruby)\s+-[ce]\b|\beval\b|\bexec\s/,
    action: "interpreter",
    suspicion: "high",
    reason: "runs code that this command does not show",
  },
  {
    pattern: /\b(?:base64|base32)\s+(?:-d|--decode)\b|\bxxd\s+-r\b|\bopenssl\s+enc\s+-d\b/,
    action: "decode.payload",
    suspicion: "high",
    reason: "decodes an encoded payload",
  },
  {
    pattern: /\b(?:curl|wget|fetch)\b.*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/,
    action: "net.download_exec",
    suspicion: "high",
    reason: "downloads and executes a remote script",
  },
  {
    pattern: /\b(?:cat|less|more|head|tail|grep|rg|awk|sed)\b[^|;]*?([^\s]*\.env\b|id_rsa|id_ed25519|\.aws\/|\.ssh\/|\.netrc|\.npmrc|\.kube\/|credentials)/,
    action: "secrets.read",
    suspicion: "high",
    reason: "reads a credential file",
    resource: (_command, match) => match[1] ?? "",
  },
  {
    pattern: /^\s*(?:env|printenv)\b|\bprintenv\b/,
    action: "secrets.enumerate",
    suspicion: "high",
    reason: "dumps the process environment",
  },
  {
    pattern: /\bunset\s+HISTFILE\b|\bHISTCONTROL\b|\bHISTIGNORE\b|\bset\s+\+o\s+history\b/,
    action: "audit.tamper",
    suspicion: "high",
    reason: "tries to disable shell history",
  },
  {
    pattern: /\bsudo\b|\bchmod\s+(?:777|a\+rwx)\b|\bchown\s+root\b/,
    action: "privilege.escalate",
    suspicion: "high",
    reason: "raises privileges",
  },
  {
    pattern: /\bmkfs(?:\.\w+)?\b|\bshred\b|\bdd\s+if=/,
    action: "fs.destroy",
    suspicion: "high",
    reason: "destroys data at the block level",
  },
  {
    pattern: /\brm\s+-[a-z]*[rf][a-z]*\s+(?:\/|~|\.\.|\$HOME)\S*/,
    action: "fs.destroy",
    suspicion: "high",
    reason: "deletes outside the working directory",
    resource: (_command, match) => firstPath(_command, match),
  },
  {
    pattern: /\brm\s+(-\S+\s+)*/,
    action: "fs.delete",
    suspicion: "normal",
    reason: "deletes files",
    resource: (_command, match) => firstPath(_command, match),
  },
  {
    pattern: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i,
    action: "db.destroy",
    suspicion: "high",
    reason: "drops a database object",
  },
  {
    pattern: /\bTRUNCATE\s+TABLE\b/i,
    action: "db.destroy",
    suspicion: "high",
    reason: "truncates a table",
  },
  {
    pattern: /\bgit\s+push\b[^|;]*(?:--force\b|\s-f\b)/,
    action: "git.force_push",
    suspicion: "high",
    reason: "rewrites remote history",
    resource: (command, match) => {
      const remote = command.match(REMOTE_TARGET);
      return remote ? `${remote[1]}/${remote[2]}` : (match[1] ?? "");
    },
  },
  {
    pattern: /\bgit\s+push\b/,
    action: "git.push",
    suspicion: "normal",
    reason: "publishes commits to a remote",
    resource: (command) => {
      const remote = command.match(REMOTE_TARGET);
      return remote ? `${remote[1]}/${remote[2]}` : "";
    },
  },
  {
    pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f)/,
    action: "git.discard",
    suspicion: "high",
    reason: "discards uncommitted work",
  },
  {
    pattern: /\bgh\s+pr\s+merge\b/,
    action: "git.pr.merge",
    suspicion: "normal",
    reason: "merges a pull request",
    resource: (_command, match) => match[1] ?? "",
  },
  {
    pattern: /\b(?:npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/,
    action: "publish.release",
    suspicion: "high",
    reason: "publishes a package",
  },
  {
    pattern: /\bterraform\s+(?:apply|destroy)\b|\bkubectl\s+(?:apply|delete|scale|rollout)\b|\bhelm\s+(?:upgrade|install|uninstall)\b/,
    action: "infra.apply",
    suspicion: "normal",
    reason: "changes deployed infrastructure",
  },
  {
    pattern: /\baws\s+\S+\s+(?:create|delete|update|put|terminate)\b|\bgcloud\s+\S+\s+(?:create|delete|update)\b/,
    action: "infra.mutate",
    suspicion: "high",
    reason: "mutates cloud resources",
  },
  {
    pattern: /\b(?:nc|ncat|telnet|ssh|scp)\b|\/dev\/(?:tcp|udp)\//,
    action: "net.egress",
    suspicion: "high",
    reason: "opens a raw network connection",
  },
  {
    pattern: /\b(?:curl|wget|fetch)\b/,
    action: "net.egress",
    suspicion: "normal",
    reason: "fetches from the network",
  },
  {
    pattern: /\b(?:pip|pip3|npm|pnpm|yarn|brew|apt|apt-get)\s+(?:install|add)\b/,
    action: "pkg.install",
    suspicion: "normal",
    reason: "installs a dependency",
  },
  {
    pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bpytest\b|\bgo\s+test\b|\bcargo\s+test\b|\bbun\s+test\b/,
    action: "test.run",
    suspicion: "low",
    reason: "runs the test suite",
  },
  {
    pattern: /^\s*(?:ls|cat|head|tail|grep|rg|find|fd|wc|stat|file|pwd|echo|git\s+(?:status|log|diff|show|branch))\b/,
    action: "fs.read",
    suspicion: "low",
    reason: "inspects local state",
  },
  {
    pattern: /\b(?:mkdir|touch)\b/,
    action: "fs.write",
    suspicion: "low",
    reason: "creates files or directories",
  },
  {
    pattern: /\b(?:mv|cp)\b|\btee\b|>>?\s*\S+/,
    action: "fs.write",
    suspicion: "normal",
    reason: "writes or moves files",
    resource: (_command, match) => firstPath(_command, match),
  },
];

interface SignalRule {
  id: string;
  pattern: RegExp;
  /** 3 forces high suspicion on its own; 2 contributes with another signal. */
  weight: number;
}

const SIGNAL_RULES: SignalRule[] = [
  { id: "pipe_to_shell", pattern: /\b(?:curl|wget|fetch)\b[^|;]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/, weight: 3 },
  { id: "encoded_payload", pattern: /\b(?:base64|base32)\s+(?:-d|--decode)\b|\bxxd\s+-r\b/, weight: 3 },
  { id: "hex_escapes", pattern: /(?:\\x[0-9a-fA-F]{2}){4,}/, weight: 2 },
  { id: "string_interpreter", pattern: /^\s*(?:sudo\s+)?(?:bash|sh|zsh|dash|python3?|node|perl|ruby)\s+-[ce]\b/, weight: 2 },
  { id: "dynamic_execution", pattern: /\beval\b|\bsource\s+<\(|\bexec\s/, weight: 2 },
  { id: "secret_paths", pattern: /(?:\.env\b|id_rsa|id_ed25519|\.aws\/|\.ssh\/|\.netrc|\.npmrc|\.kube\/|keychain)/, weight: 3 },
  { id: "audit_tamper", pattern: /\bunset\s+HISTFILE\b|\bHISTCONTROL\b|\bset\s+\+o\s+history\b/, weight: 3 },
  { id: "egress_bypass", pattern: /\/dev\/(?:tcp|udp)\/|\bnc\s+-|\bncat\b/, weight: 3 },
  { id: "write_outside_cwd", pattern: />\s*\/(?:etc|usr|bin|sbin|var|root)\//, weight: 3 },
  { id: "privilege_escalation", pattern: /\bsudo\b|\bchmod\s+(?:777|a\+rwx)\b/, weight: 2 },
  { id: "download_then_execute", pattern: /\b(?:curl|wget)\b.*-o\s+\S+.*(?:&&|;).*(?:chmod\s+\+x|\.\/)/, weight: 3 },
];

interface Match {
  rule: ActionRule;
  command: string;
  match: RegExpMatchArray;
}

function bestMatch(commands: string[]): Match | null {
  let best: Match | null = null;
  for (const command of commands) {
    for (const rule of ACTION_RULES) {
      const match = command.match(rule.pattern);
      if (!match) continue;
      if (best === null || SEVERITY[rule.suspicion] > SEVERITY[best.rule.suspicion]) {
        best = { rule, command, match };
      }
      break;
    }
  }
  return best;
}

function signalsFor(command: string): string[] {
  const found: string[] = [];
  for (const rule of SIGNAL_RULES) {
    if (rule.pattern.test(command)) found.push(rule.id);
  }
  return found;
}

/**
 * Assess one shell command. Pure: no DB, no network, no model.
 *
 * `suspicion` is the maximum of the matched rule severity and the signal weight. A command
 * with no matching rule is `unknown`, which callers must treat as "ask", never "allow".
 */
export function assessBash(command: string): BashAssessment {
  const normalized = command.replace(/\s+/g, " ").trim();
  const subcommands = splitSubcommands(command);
  const substitutions = subcommands.flatMap(extractSubstitutions);
  const all = [...subcommands, ...substitutions];

  const signals = signalsFor(command);
  const best = bestMatch(all);
  const actions = distinctActions(all);

  let suspicion: Suspicion = best ? best.rule.suspicion : "unknown";
  const weight = signals.reduce(
    (total, id) => total + (SIGNAL_RULES.find((rule) => rule.id === id)?.weight ?? 0),
    0,
  );
  if (weight >= 3) suspicion = "high";

  const action = best?.rule.action ?? "unknown";
  const resource = best?.rule.resource?.(best.command, best.match) ?? "";
  const reason = best
    ? best.rule.reason
    : subcommands.length === 0
      ? "empty command"
      : "unrecognised command";

  return {
    action,
    actions,
    resource,
    suspicion,
    reason,
    signals,
    subcommands: all,
    confidence: best ? (suspicion === "high" ? 0.95 : 0.9) : 0.4,
  };
}

function distinctActions(commands: string[]): string[] {
  const seen: string[] = [];
  for (const command of commands) {
    for (const rule of ACTION_RULES) {
      if (!rule.pattern.test(command)) continue;
      if (!seen.includes(rule.action)) seen.push(rule.action);
      break;
    }
  }
  return seen;
}

export interface ToolAssessment {
  action: string;
  resource: string;
  suspicion: Suspicion;
  reason: string;
  signals: string[];
  command?: string;
  subcommands?: string[];
}

const WRITE_TOOLS = new Set(["edit", "write", "multiedit", "notebookedit", "applypatch", "patch"]);
const READ_TOOLS = new Set(["read", "glob", "grep", "ls", "view", "notebookread"]);
const FETCH_TOOLS = new Set(["webfetch", "websearch", "fetch"]);

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** `mcp__github__create_issue` → `{ server: "github", tool: "create_issue" }`. */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  const match = name.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (!match) return null;
  return { server: match[1] ?? "", tool: match[2] ?? "" };
}

/**
 * Assessment for any tool call, not just shell. Host tools are mapped onto the same action
 * vocabulary as managed tools, so one policy rule can cover `bash: git push` and the
 * `github` MCP tool.
 */
export function assessTool(tool: string, input: unknown): ToolAssessment {
  const name = tool.trim();
  const lower = name.toLowerCase();
  const fields = record(input);

  if (lower === "bash" || lower === "shell") {
    const command = str(fields["command"] ?? fields["cmd"]);
    const assessed = assessBash(command);
    return {
      action: assessed.action,
      resource: assessed.resource,
      suspicion: assessed.suspicion,
      reason: assessed.reason,
      signals: assessed.signals,
      command,
      subcommands: assessed.subcommands,
    };
  }

  const mcp = parseMcpToolName(name);
  if (mcp) {
    return {
      action: `${slug(mcp.server)}.${slug(mcp.tool)}`,
      resource: "",
      suspicion: "normal",
      reason: `calls ${mcp.server} tool ${mcp.tool}`,
      signals: [],
    };
  }

  const path = str(fields["file_path"] ?? fields["filePath"] ?? fields["path"]);
  if (WRITE_TOOLS.has(lower)) {
    return {
      action: "fs.write",
      resource: path,
      suspicion: "normal",
      reason: "writes a file",
      signals: [],
    };
  }
  if (READ_TOOLS.has(lower)) {
    return {
      action: "fs.read",
      resource: path,
      suspicion: "low",
      reason: "reads local state",
      signals: [],
    };
  }
  if (FETCH_TOOLS.has(lower)) {
    const url = str(fields["url"]);
    return {
      action: lower === "websearch" ? "net.search" : "net.fetch",
      resource: hostOf(url),
      suspicion: "normal",
      reason: "fetches from the network",
      signals: [],
    };
  }

  return {
    action: `tool.${slug(name) || "unknown"}`,
    resource: path || str(fields["url"]),
    suspicion: "unknown",
    reason: "unrecognised tool",
    signals: [],
  };
}
