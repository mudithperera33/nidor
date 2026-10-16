import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(root, ".vercel/output");

function build(packageName, extraEnv = {}) {
  const result = spawnSync("pnpm", ["--filter", packageName, "run", "build"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", ...extraEnv },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build failed for ${packageName}.`);
}

// Use the documented Build Output API, avoiding monorepo dependency tracing
// and ensuring the webhook receives unmodified bytes.
await rm(output, { recursive: true, force: true });
build("@workspace/nidor", { PORT: "3000", BASE_PATH: "/" });
build("@workspace/api-server");

const functionDir = path.join(output, "functions/api.func");
await mkdir(functionDir, { recursive: true });
await cp(path.join(root, "artifacts/nidor/dist/public"), path.join(output, "static"), { recursive: true });
await cp(path.join(root, "artifacts/api-server/dist"), functionDir, {
  recursive: true,
  filter: (source) => !source.endsWith(".map"),
});
await writeFile(path.join(functionDir, ".vc-config.json"), JSON.stringify({
  runtime: "nodejs22.x",
  handler: "vercel.mjs",
  launcherType: "Nodejs",
  shouldAddHelpers: false,
  maxDuration: 60,
  environment: { NODE_ENV: "production" },
}, null, 2));
await writeFile(path.join(output, "config.json"), JSON.stringify({
  version: 3,
  routes: [
    { src: "/api(?:/.*)?", dest: "/api" },
    { handle: "filesystem" },
    { src: "/.*", dest: "/index.html" },
  ],
}, null, 2));
