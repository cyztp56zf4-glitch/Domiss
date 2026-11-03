import express from "express";
import os from "node:os";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AIError, EditRequest, MODEL, runEdit } from "./ai";

const app = express();

// Optional password (HTTP Basic, any username) – needed once the app is reachable from the internet,
// otherwise anyone with the link could spend your Claude API credit.
const password = process.env.APP_PASSWORD;
if (password) {
  const expected = Buffer.from(password);
  app.use((req, res, next) => {
    if (req.path === "/api/health") return next(); // hosting health checks; reveals nothing sensitive
    const header = req.headers.authorization ?? "";
    const given = header.startsWith("Basic ")
      ? Buffer.from(Buffer.from(header.slice(6), "base64").toString().split(":").slice(1).join(":"))
      : Buffer.alloc(0);
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next();
    res.set("WWW-Authenticate", 'Basic realm="Domiss", charset="UTF-8"').status(401).send("Zadej heslo k Domiss.");
  });
}

app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL, aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.post("/api/ai/edit", async (req, res) => {
  const parsed = EditRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Neplatný požadavek", details: parsed.error.issues });
    return;
  }
  try {
    const plan = await runEdit(parsed.data);
    res.json({ mode: parsed.data.mode, plan });
  } catch (err) {
    const status = err instanceof AIError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ai/edit]", message);
    res.status(status).json({ error: message });
  }
});

if (process.env.NODE_ENV === "production") {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, "../dist");
  // hashed build assets (incl. ~60 MB of wasm) never change → let the phone cache them
  app.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "1y" }));
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`Domiss API běží na http://localhost:${port} (model ${MODEL})`);
  if (process.env.NODE_ENV === "production") {
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .filter((a) => a && a.family === "IPv4" && !a.internal)
      .map((a) => `http://${a!.address}:${port}`);
    if (lan.length) console.log(`Na telefonu ve stejné Wi-Fi: ${lan.join("  ")}`);
  }
  if (process.env.NODE_ENV === "production" && !password) {
    console.warn("Pozor: APP_PASSWORD není nastaveno – kdokoli s odkazem může appku (a tvůj API klíč) používat.");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("Pozor: ANTHROPIC_API_KEY není nastaven – AI střih nebude fungovat.");
  }
});
