/**
 * CLI surface (ingest / policy / engine / drafts / send).
 */
import { loadSeed } from "./ingest.ts";
import { openDb } from "./db.ts";
import { DB_PATH } from "./paths.ts";

function usage(): void {
  console.log(`follow-up engine
  npm run ingest
  npm run policy
  npm run engine
  npx tsx src/app.ts --help
`);
}

const command = process.argv[2];
if (!command || command === "--help" || command === "help") {
  usage();
  process.exit(0);
}

if (command === "ingest") {
  const db = openDb();
  const result = loadSeed(db, { onWarning: (msg) => console.warn(msg) });
  console.log(
    JSON.stringify(
      {
        db: DB_PATH,
        quotes: result.quotes,
        eventLines: result.eventLines,
        eventsInserted: result.eventsInserted,
        uniqueEventIds: result.uniqueEventIds,
        warningCount: result.warnings.length,
      },
      null,
      2,
    ),
  );
  db.close();
  process.exit(0);
}

console.error(`command not implemented: ${command}`);
process.exit(1);
