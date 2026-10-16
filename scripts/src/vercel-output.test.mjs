import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { test } from "node:test";

const output = new URL("../../.vercel/output/", import.meta.url);

test("Vercel output keeps API routes ahead of the SPA fallback and preserves webhook bytes", async () => {
  const routing = JSON.parse(await readFile(new URL("config.json", output), "utf8"));
  assert.equal(routing.version, 3);
  assert(new RegExp(`^${routing.routes[0].src}$`).test("/api/webhooks/resend"));
  assert.equal(routing.routes[0].dest, "/api");
  assert.equal(routing.routes[1].handle, "filesystem");
  assert.equal(routing.routes[2].dest, "/index.html");
  const config = JSON.parse(await readFile(new URL("functions/api.func/.vc-config.json", output), "utf8"));
  assert.equal(config.launcherType, "Nodejs");
  assert.equal(config.runtime, "nodejs22.x");
  assert.equal(config.shouldAddHelpers, false);
  assert.equal(config.handler, "vercel.mjs");
  await access(new URL("static/index.html", output));
});

test("built serverless handler serves the API without starting timers or requiring Replit credentials", async (t) => {
  process.env.NODE_ENV = "production";
  const { default: handler } = await import(new URL("functions/api.func/vercel.mjs", output));
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/api/healthz`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get("content-type"), /application\/json/);
  const maintenance = await fetch(`${base}/api/internal/maintenance`);
  assert([401, 503].includes(maintenance.status));
  assert.equal(maintenance.headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${base}/api/does-not-exist`)).status, 404);
});
