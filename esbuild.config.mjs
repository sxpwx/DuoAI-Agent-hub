import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  logLevel: "info",
};

// 插件主体（Obsidian 运行时）
await esbuild.build({
  ...common,
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  define: { "process.env.NODE_ENV": prod ? '"production"' : '"development"' },
});

// MCP stdio 桥接脚本（由 agent CLI 作为子进程启动，纯 Node，无外部依赖）
await esbuild.build({
  ...common,
  entryPoints: ["mcp-bridge/bridge.ts"],
  outfile: "mcp-bridge.js",
  external: [],
});

console.log("build ok");