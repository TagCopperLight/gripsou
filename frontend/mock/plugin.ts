// Vite plugin behind `bun run dev:mock`: answers /api/* from the in-memory
// store instead of proxying to the Rust server, exposes /__mock/* for the
// review panel and injects the panel. Dev server only (`apply: "serve"`), and
// vite.config.ts only imports it in mock mode, so a build never sees it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { createControl, type OverrideMode } from "./control";
import { FOCUS, STATES } from "./states";

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

type Held = { path: string; release: () => void };

// Vite restarts the server whenever a file under mock/ changes; the active
// states are kept here so a restart doesn't drop them mid-review.
const CACHE_DIR = "node_modules/.cache";
const ACTIVE_FILE = `${CACHE_DIR}/gripsou-mock-states.json`;

function loadActive(): string[] {
  try {
    return JSON.parse(readFileSync(ACTIVE_FILE, "utf8")) as string[];
  } catch {
    return [];
  }
}

function saveActive(active: string[]): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(ACTIVE_FILE, JSON.stringify(active));
}

// Signs in on the first visit only, so signing out (to review the login
// screen) sticks across reloads.
const BOOTSTRAP = `
if (!localStorage.getItem("gripsou.mock.started")) {
  localStorage.setItem("gripsou.mock.started", "1");
  localStorage.setItem("gripsou.token", "mock");
}`;

export function mockApi(): Plugin {
  const control = createControl(STATES, FOCUS, loadActive(), saveActive);
  let held: Held[] = [];

  async function api(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://mock");
    const method = req.method ?? "GET";
    const body = await readBody(req);
    const answer = () => {
      const out = control.handle(method, url.pathname, url.searchParams, body);
      if (out === "hold") held.push({ path: url.pathname, release: answer });
      else send(res, out.status, out.body);
    };
    answer();
  }

  async function panel(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://mock").pathname;
    const body = (await readBody(req)) as Record<string, unknown> | undefined;
    if (req.method === "GET" && path === "/info") return send(res, 200, control.info());
    if (req.method !== "POST") return send(res, 404);
    switch (path) {
      case "/reset":
        control.reset();
        break;
      case "/state":
        control.setState(String(body?.id), Boolean(body?.on));
        break;
      case "/override": {
        const target = String(body?.path);
        control.setOverride(target, (body?.mode as OverrideMode | null) ?? null);
        const release = held.filter((h) => h.path === target);
        held = held.filter((h) => h.path !== target);
        release.forEach((h) => h.release());
        break;
      }
      case "/role":
        control.store().user.role = body?.role === "user" ? "user" : "admin";
        break;
      default:
        return send(res, 404);
    }
    send(res, 204);
  }

  return {
    name: "gripsou-mock-api",
    apply: "serve",
    configureServer(server) {
      const fail = (res: ServerResponse) => (err: unknown) => send(res, 500, { error: String(err) });
      server.middlewares.use("/api", (req, res) => void api(req, res).catch(fail(res)));
      server.middlewares.use("/__mock", (req, res) => void panel(req, res).catch(fail(res)));
    },
    transformIndexHtml() {
      return [
        { tag: "script", children: BOOTSTRAP, injectTo: "head-prepend" },
        { tag: "script", attrs: { type: "module", src: "/mock/panel/main.tsx" }, injectTo: "body" },
      ];
    },
  };
}
