// Runs the official Nuvio plugin worker bundle (QuickJS sandbox) inside a Node worker thread.
import { parentPort } from "node:worker_threads";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const dir = path.dirname(fileURLToPath(import.meta.url));
globalThis.self = globalThis;
globalThis.require = createRequire(import.meta.url);
globalThis.postMessage = (m) => parentPort.postMessage(m);
globalThis.importScripts = (...files) => { for (const rel of files) { const p = path.join(dir, "libs", path.basename(String(rel))); vm.runInThisContext(fs.readFileSync(p, "utf8"), { filename: p }); } };
vm.runInThisContext(fs.readFileSync(path.join(dir, "plugin-worker.js"), "utf8"), { filename: "plugin-worker.js" });
parentPort.on("message", (data) => { if (typeof globalThis.onmessage === "function") globalThis.onmessage({ data }); });
parentPort.postMessage({ type: "ready" });

