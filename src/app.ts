/**
 * CLI demo surface. Boot loads seed. Four screens; refused sends are visible.
 */
import { DEMO_NOW } from "./clock.ts";
import { KAREN_PHONE } from "./config.ts";
import { openDb } from "./db.ts";
import {
  renderDrafts,
  renderEngineHelp,
  renderFollowUps,
  renderOutbox,
  renderRefused,
} from "./display.ts";
import {
  approveDraft,
  editDraft,
  ensureDraft,
  getDraft,
  latestDraftForQuote,
  listDrafts,
  openDraftForQuote,
  rejectDraft,
} from "./drafts.ts";
import { run as runEngine } from "./engine.ts";
import { loadSeed } from "./ingest.ts";
import { FileProvider, listOutbox, SendError, sendDraft } from "./outbox.ts";
import { DB_PATH, OUTBOX_LOG_PATH } from "./paths.ts";
import { evaluateFromDb } from "./policy.ts";
import { customerIndexFromDb, projectFromDb, readQuotes } from "./project.ts";

function usage(): void {
  console.log(`follow-up engine (CLI)

  npm install && npm start

  Screens (optional --now=ISO):
  1. npm run policy -- [--now=ISO]
  2. npx tsx --experimental-sqlite src/app.ts drafts [--now=ISO]
  3. npx tsx --experimental-sqlite src/app.ts outbox
  4. npm run engine -- [--now=ISO] [--top=10]

  npx tsx --experimental-sqlite src/app.ts approve Q-1012
  npx tsx --experimental-sqlite src/app.ts reject Q-1012
  npx tsx --experimental-sqlite src/app.ts send Q-1012 [--now=ISO]
  npx tsx --experimental-sqlite src/app.ts draft Q-1012 [--now=ISO]
`);
}

function flag(name: string): string | undefined {
  const prefix = `${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit?.slice(prefix.length);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function resolveDraftArg(
  database: ReturnType<typeof openDb>,
  id: string,
  forSend = false,
): string {
  if (!id.startsWith("Q-")) return id;
  const open = openDraftForQuote(database, id);
  if (open) return open.id;
  if (forSend) {
    const latest = latestDraftForQuote(database, id);
    if (latest) return latest.id;
  }
  throw new Error(`no draft for ${id}`);
}

function showDashboard(nowIso: string): void {
  const db = openDb();
  loadSeed(db);
  const policy = evaluateFromDb(db, nowIso);
  console.log(renderFollowUps(policy));
  console.log("");
  console.log(renderDrafts(listDrafts(db), policy));
  console.log("");
  console.log(renderOutbox(listOutbox(db)));
  console.log("");
  console.log(renderEngineHelp(nowIso));
  db.close();
}

const command = process.argv[2];
const now = flag("--now") || DEMO_NOW;

if (command === "--help" || command === "help") {
  usage();
  process.exit(0);
}

if (!command || command === "dashboard" || command === "start") {
  showDashboard(now);
  process.exit(0);
}

const db = openDb();
loadSeed(db);

if (command === "ingest") {
  const result = loadSeed(db);
  const projections = projectFromDb(db);
  const customers = customerIndexFromDb(db);
  const fixtureIds = ["Q-1004", "Q-1009", "Q-1005", "Q-1003", "Q-1025"];
  printJson({
    db: DB_PATH,
    quotes: result.quotes,
    eventLines: result.eventLines,
    eventsInserted: result.eventsInserted,
    uniqueEventIds: result.uniqueEventIds,
    warningCount: result.warnings.length,
    fixtures: Object.fromEntries(fixtureIds.map((id) => [id, projections.get(id)])),
    karen: {
      phone: KAREN_PHONE,
      quotesForPhone: customers.quotesForPhone.get(KAREN_PHONE),
      lastOutboundForPhone: customers.lastOutboundForPhone.get(KAREN_PHONE),
    },
  });
  db.close();
  process.exit(0);
}

if (command === "engine" || command === "run") {
  const topFlag = flag("--top");
  const topN = topFlag ? Number(topFlag) : undefined;
  const result = runEngine(db, now, { topN });
  console.log(renderEngineHelp(now, result));
  db.close();
  process.exit(0);
}

if (command === "policy") {
  console.log(renderFollowUps(evaluateFromDb(db, now)));
  db.close();
  process.exit(0);
}

if (command === "drafts") {
  console.log(renderDrafts(listDrafts(db), evaluateFromDb(db, now)));
  db.close();
  process.exit(0);
}

if (command === "draft") {
  const quoteId = process.argv[3];
  if (!quoteId) {
    console.error("usage: draft <quote-id>");
    db.close();
    process.exit(1);
  }
  const policy = evaluateFromDb(db, now);
  const candidate = policy.actionable.find((row) => row.quote_id === quoteId);
  if (!candidate) {
    console.error(renderRefused("not_actionable", `not actionable at ${now}: ${quoteId}`));
    db.close();
    process.exit(1);
  }
  const quote = readQuotes(db).find((row) => row.id === quoteId);
  if (!quote) {
    console.error(renderRefused("not_found", `quote not in catalog: ${quoteId}`));
    db.close();
    process.exit(1);
  }
  printJson(ensureDraft(db, quote, candidate, now));
  db.close();
  process.exit(0);
}

if (command === "approve" || command === "reject") {
  const id = process.argv[3];
  if (!id) {
    console.error(`usage: ${command} <draft-id>`);
    db.close();
    process.exit(1);
  }
  try {
    const draftId = resolveDraftArg(db, id);
    printJson(
      command === "approve" ? approveDraft(db, draftId) : rejectDraft(db, draftId),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(renderRefused(command, message));
    db.close();
    process.exit(1);
  }
  db.close();
  process.exit(0);
}

if (command === "edit") {
  const id = process.argv[3];
  const body = flag("--body");
  if (!id || !body) {
    console.error("usage: edit <draft-id> --body=...");
    db.close();
    process.exit(1);
  }
  try {
    printJson(editDraft(db, resolveDraftArg(db, id), body));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(renderRefused("edit", message));
    db.close();
    process.exit(1);
  }
  db.close();
  process.exit(0);
}

if (command === "send") {
  const id = process.argv[3];
  if (!id) {
    console.error("usage: send <draft-id>");
    db.close();
    process.exit(1);
  }
  try {
    printJson(
      sendDraft(
        db,
        resolveDraftArg(db, id, true),
        now,
        new FileProvider(OUTBOX_LOG_PATH),
      ),
    );
  } catch (error) {
    if (error instanceof SendError) {
      console.error(renderRefused(error.code, error.message));
      db.close();
      process.exit(1);
    }
    throw error;
  }
  db.close();
  process.exit(0);
}

if (command === "outbox") {
  console.log(renderOutbox(listOutbox(db)));
  db.close();
  process.exit(0);
}

if (command === "show") {
  const id = process.argv[3];
  printJson(id ? getDraft(db, id) : null);
  db.close();
  process.exit(0);
}

console.error(`command not implemented: ${command}`);
db.close();
process.exit(1);
