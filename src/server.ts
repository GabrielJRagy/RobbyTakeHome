import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { DEMO_NOW } from "./clock.ts";
import { approveDraft, latestDraftForQuote, listDrafts, openDraftForQuote, rejectDraft } from "./drafts.ts";
import { openDb, wipeDbFiles, type Db } from "./db.ts";
import { run as runEngine } from "./engine.ts";
import { loadSeed } from "./ingest.ts";
import { FileProvider, listOutbox, SendError, sendDraft } from "./outbox.ts";
import { OUTBOX_LOG_PATH, PUBLIC_DIR, WEB_DB_PATH } from "./paths.ts";
import { evaluateFromDb } from "./policy.ts";
import { readEvents, readQuotes } from "./project.ts";

const PORT = Number(process.env.PORT) || 3456;

let db: Db = openDb(WEB_DB_PATH);

function resolveDraftId(id: string, forSend = false): string {
  if (!id.startsWith("Q-")) return id;
  const open = openDraftForQuote(db, id);
  if (open) return open.id;
  if (forSend) {
    const latest = latestDraftForQuote(db, id);
    if (latest) return latest.id;
  }
  throw new SendError("not_found", `no draft for ${id}`);
}

function snapshot(now: string) {
  const quotes = readQuotes(db).sort((a, b) => a.id.localeCompare(b.id));
  const started = quotes.length > 0;
  const events = started
    ? [...readEvents(db)].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    : [];
  const policy = started
    ? evaluateFromDb(db, now)
    : { now, actionable: [], suppressed: [] };
  return {
    now,
    started,
    ingest: started
      ? { quotes: quotes.length, events: events.length }
      : null,
    quotes,
    events,
    policy,
    drafts: started ? listDrafts(db) : [],
    outbox: started ? listOutbox(db) : [],
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

function serveStatic(urlPath: string, res: ServerResponse): void {
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const file = join(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
  };
  res.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
  });
  res.end(readFileSync(file));
}

function resetApp(): void {
  db.close();
  wipeDbFiles(WEB_DB_PATH);
  if (existsSync(OUTBOX_LOG_PATH)) unlinkSync(OUTBOX_LOG_PATH);
  db = openDb(WEB_DB_PATH);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      const now = url.searchParams.get("now") || DEMO_NOW;
      sendJson(res, 200, snapshot(now));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ingest") {
      const body = await readJson(req);
      const now = typeof body.now === "string" ? body.now : DEMO_NOW;
      const result = loadSeed(db);
      sendJson(res, 200, { result, state: snapshot(now) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/engine") {
      const body = await readJson(req);
      const now = typeof body.now === "string" ? body.now : DEMO_NOW;
      const engine = runEngine(db, now);
      sendJson(res, 200, { engine, state: snapshot(now) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/approve") {
      const body = await readJson(req);
      const id = String(body.id ?? "");
      const now = typeof body.now === "string" ? body.now : DEMO_NOW;
      const draft = approveDraft(db, resolveDraftId(id));
      sendJson(res, 200, { draft, state: snapshot(now) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reject") {
      const body = await readJson(req);
      const id = String(body.id ?? "");
      const now = typeof body.now === "string" ? body.now : DEMO_NOW;
      const draft = rejectDraft(db, resolveDraftId(id));
      sendJson(res, 200, { draft, state: snapshot(now) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/send") {
      const body = await readJson(req);
      const id = String(body.id ?? "");
      const now = typeof body.now === "string" ? body.now : DEMO_NOW;
      const outcome = sendDraft(
        db,
        resolveDraftId(id, true),
        now,
        new FileProvider(OUTBOX_LOG_PATH),
      );
      sendJson(res, 200, { outcome, state: snapshot(now) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/reset") {
      const body = await readJson(req);
      const now = typeof body.now === "string" ? body.now : DEMO_NOW;
      resetApp();
      sendJson(res, 200, { state: snapshot(now) });
      return;
    }

    if (req.method === "GET") {
      serveStatic(url.pathname, res);
      return;
    }

    res.writeHead(404);
    res.end("not found");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof SendError ? error.code : "error";
    sendJson(res, 400, { error: { code, message } });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`follow-up UI  http://127.0.0.1:${PORT}`);
});
