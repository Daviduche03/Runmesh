import { describe, expect, it } from "vitest";
import { parseArgs, toolNamesOf } from "./replay.js";

describe("parseArgs", () => {
  it("reads the positional run id and flags", () => {
    const opts = parseArgs(
      ["run_1", "--module", "./m.mjs", "--strict", "--no-record", "--json"],
      {},
    );
    expect(opts.runId).toBe("run_1");
    expect(opts.modulePath).toBe("./m.mjs");
    expect(opts.strict).toBe(true);
    expect(opts.record).toBe(false);
    expect(opts.json).toBe(true);
  });

  it("falls back to env for endpoint, key, and workspace", () => {
    const opts = parseArgs([], {
      RUNMESH_ENDPOINT: "https://x",
      RUNMESH_API_KEY: "k",
      RUNMESH_WORKSPACE_ID: "ws_1",
    });
    expect(opts.endpoint).toBe("https://x");
    expect(opts.apiKey).toBe("k");
    expect(opts.workspaceId).toBe("ws_1");
  });

  it("recognizes help", () => {
    expect(parseArgs(["--help"], {}).help).toBe(true);
  });
});

describe("toolNamesOf", () => {
  it("accepts manifest objects and bare strings", () => {
    expect(toolNamesOf([{ name: "a" }, "b", { nope: 1 }])).toEqual(["a", "b"]);
    expect(toolNamesOf(null)).toEqual([]);
  });
});
