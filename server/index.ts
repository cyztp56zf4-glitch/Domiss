import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AIError, EditRequest, MODEL, runEdit } from "./ai";

const app = express();
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
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`Domiss API běží na http://localhost:${port} (model ${MODEL})`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("Pozor: ANTHROPIC_API_KEY není nastaven – AI střih nebude fungovat.");
  }
});
