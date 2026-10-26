import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

// Development-only launcher. Production start/build commands remain unchanged.
// Keep compiler/IPC/cache files on the workspace volume, not the quota-limited /tmp.
const runtime = new URL("../.local/development-runtime/", import.meta.url);
const tmp = fileURLToPath(new URL("tmp/", runtime));
const cache = fileURLToPath(new URL("cache/", runtime));
const compile = fileURLToPath(new URL("node/", runtime));
await Promise.all([tmp, cache, compile].map(path => mkdir(path, { recursive: true })));
const [command, ...args] = process.argv.slice(2);
if (!command) throw Error("A Development command is required.");
// Fork previews have their own hostname. Bind Development-only callbacks at
// launch rather than committing a fork hostname over the main workspace URL.
const developmentAuth = process.env.QXLAYER_EXTERNAL_ENVIRONMENT === "development" &&
  /^[a-z0-9.-]+\.replit\.dev$/.test(process.env.REPLIT_DEV_DOMAIN ?? "")
  ? {
    QXLAYER_DEVELOPMENT_SUPABASE_AUTH_URL: `https://${process.env.REPLIT_DEV_DOMAIN}`,
    VITE_QXLAYER_DEVELOPMENT_SUPABASE_AUTH_URL: `https://${process.env.REPLIT_DEV_DOMAIN}`,
  } : {};
const child = spawn(command, args, { stdio: "inherit", env: { ...process.env,
  ...developmentAuth,
  TMPDIR: tmp, XDG_CACHE_HOME: cache, NODE_COMPILE_CACHE: compile } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { console.error("Development command failed:", error.message); process.exitCode = 1; });
child.on("exit", (code, signal) => {
  if (signal) process.exitCode = signal === "SIGINT" ? 130 : 143;
  else process.exitCode = code ?? 1;
});
