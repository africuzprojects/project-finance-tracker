/**
 * Vercel / CI: set env SUPABASE_URL and SUPABASE_ANON_KEY in the dashboard.
 * Local: copy .env.example → .env — `npm run build` loads .env automatically (via dotenv).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
dotenv.config({ path: envPath });

const outPath = path.join(root, "js", "env.generated.js");

const url = (process.env.SUPABASE_URL || "").trim();
const anonKey = (process.env.SUPABASE_ANON_KEY || "").trim();

const payload = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
};

const content = `/* Generated at build — do not commit secrets. Re-run: npm run build */
window.__PFT_ENV__ = ${JSON.stringify(payload)};
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, content, "utf8");
console.log("env.generated.js written:", url ? "URL set" : "empty (local Settings / sync page)");
