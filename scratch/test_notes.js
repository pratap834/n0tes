const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const match = env.match(/DATABASE_URL=["']?([^"'\r\n]+)/);
const dbUrl = match ? match[1] : null;

const { neon } = require('@neondatabase/serverless');
const sql = neon(dbUrl);

async function run() {
  const rows = await sql`SELECT * FROM notes ORDER BY updated_at DESC;`;
  console.log('Rows count:', rows.length);
  for (const r of rows) {
    console.log(r.id, r.section_id, r.title);
  }
}

run().catch(console.error);
