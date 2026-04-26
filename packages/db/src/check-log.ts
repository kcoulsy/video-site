import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: "../../apps/server/.env" });

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const rows = await client.query(
    `SELECT id, actor_id, action, target_type, target_id, reason, created_at FROM moderation_action ORDER BY created_at DESC LIMIT 20`,
  );
  console.log(`Rows: ${rows.rows.length}`);
  for (const r of rows.rows) {
    console.log(JSON.stringify(r));
  }

  const reports = await client.query(`SELECT count(*)::int FROM report`);
  console.log("Reports:", reports.rows[0]?.count);
} finally {
  await client.end();
}
