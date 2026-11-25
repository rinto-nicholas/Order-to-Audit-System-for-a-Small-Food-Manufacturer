import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase } from './db.js';
import { seedDatabase } from './seed.js';
import { createApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dbPath = process.env.DB_PATH || path.join(rootDir, 'data', 'snacks_factory.db');
const port = Number(process.env.PORT || 3001);

const db = initDatabase(dbPath);
seedDatabase(db);

const app = createApp(db, { distDir: path.join(rootDir, 'dist') });

app.listen(port, () => {
  console.log(`Order-to-Audit API listening on http://localhost:${port}`);
});
