/**
 * Copy static web assets into www/ for Capacitor (before `cap sync`).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const www = path.join(root, "www");

const entries = [
  "index.html",
  "sync.html",
  "manifest.json",
  "icon.svg",
  "css",
  "js",
  "assets",
];

function copyEntry(rel) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) return;
  const dest = path.join(www, rel);
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.cpSync(src, dest, { recursive: true });
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

for (const rel of entries) {
  copyEntry(rel);
}

console.log("Copied web assets to www/");
