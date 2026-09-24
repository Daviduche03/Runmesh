import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli/replay.ts"],
  format: ["esm"],
  target: "node18",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
