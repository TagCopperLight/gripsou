// Vite plugin behind `bun run dev:mock`: answers /api/* from the in-memory
// store instead of proxying to the Rust server, and exposes /__mock/* for the
// review panel. Dev server only (`apply: "serve"`), so a build never sees it.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { router } from "./routes";
import { getStore, resetStore } from "./store";

const unhandled = new Set<string>();

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : JSON.parse(text);
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.statusCode = status;
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://mock");
  const method = req.method ?? "GET";
  const out = router.dispatch(getStore(), method, url.pathname, url.searchParams, await readBody(req));
  if (out.status === 501) unhandled.add(`${method} ${url.pathname}`);
  send(res, out.status, out.body);
}

function handleControl(req: IncomingMessage, res: ServerResponse): void {
  const path = new URL(req.url ?? "/", "http://mock").pathname;
  if (req.method === "POST" && path === "/reset") {
    resetStore();
    unhandled.clear();
    send(res, 204);
  } else if (req.method === "GET" && path === "/unhandled") {
    send(res, 200, [...unhandled]);
  } else {
    send(res, 404);
  }
}

// Signs in on the first visit only, so signing out (to review the login
// screen) sticks across reloads.
const BOOTSTRAP = `
if (!localStorage.getItem("gripsou.mock.started")) {
  localStorage.setItem("gripsou.mock.started", "1");
  localStorage.setItem("gripsou.token", "mock");
}`;

export function mockApi(): Plugin {
  return {
    name: "gripsou-mock-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api", (req, res) => {
        handleApi(req, res).catch((err: unknown) => send(res, 500, { error: String(err) }));
      });
      server.middlewares.use("/__mock", handleControl);
    },
    transformIndexHtml() {
      return [{ tag: "script", children: BOOTSTRAP, injectTo: "head-prepend" }];
    },
  };
}
