import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Resolves ANTHROPIC_API_KEY (or another configured credential) from the environment.
  client ??= new Anthropic();
  return client;
}

export const SegmentIn = z.object({
  i: z.number().int(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
});
export type SegmentIn = z.infer<typeof SegmentIn>;

export const EditRequest = z.object({
  mode: z.enum(["cut", "highlights", "metadata"]),
  instruction: z.string().max(4000).default(""),
  targetSeconds: z.number().positive().optional(),
  language: z.string().default("cs"),
  segments: z.array(SegmentIn).min(1).max(20000),
});
export type EditRequest = z.infer<typeof EditRequest>;

const CutPlan = z.object({
  summary: z.string().describe("Krátké shrnutí, co a proč bylo vystřiženo."),
  keep: z
    .array(
      z.object({
        from: z.number().int().describe("Index prvního ponechaného segmentu"),
        to: z.number().int().describe("Index posledního ponechaného segmentu (včetně)"),
        reason: z.string(),
      }),
    )
    .describe("Ponechané úseky v chronologickém pořadí"),
});

const HighlightPlan = z.object({
  clips: z.array(
    z.object({
      title: z.string().describe("Pracovní název klipu"),
      hook: z.string().describe("Proč tenhle moment zaujme hned v první vteřině"),
      from: z.number().int(),
      to: z.number().int(),
      score: z.number().int().describe("1–10, jak silný je klip samostatně"),
    }),
  ),
});

const MetadataPlan = z.object({
  titles: z.array(z.string()).describe("3–5 návrhů názvu videa"),
  description: z.string(),
  chapters: z.array(z.object({ segment: z.number().int(), title: z.string() })),
  tags: z.array(z.string()),
});

export type CutPlan = z.infer<typeof CutPlan>;
export type HighlightPlan = z.infer<typeof HighlightPlan>;
export type MetadataPlan = z.infer<typeof MetadataPlan>;

const SYSTEM = `Jsi zkušený střihač videa a pracuješ s přepisem nahrávky. Přepis dostaneš rozdělený na očíslované segmenty ve tvaru "[index] start–end: text" (časy v sekundách).

Pravidla:
- Odkazuj výhradně na indexy segmentů, které v přepisu existují. Nikdy si nevymýšlej časy ani text.
- Střihej po celých segmentech; úsek je vždy souvislá řada segmentů od "from" do "to" včetně.
- Respektuj pokyn uživatele. Když nějaký pokyn chybí, rozhodni se tak, jak by to udělal dobrý střihač: zachovej smysl a srozumitelnost, odstraň opakované pokusy (ponech poslední povedenou verzi), přeřeky, odbočky a hluchá místa.
- Odpovídej v jazyce přepisu.`;

function formatTranscript(segments: SegmentIn[]): string {
  return segments.map((s) => `[${s.i}] ${s.start.toFixed(1)}–${s.end.toFixed(1)}: ${s.text}`).join("\n");
}

function taskFor(req: EditRequest): string {
  const target = req.targetSeconds ? `Cílová délka výsledku je přibližně ${Math.round(req.targetSeconds)} s.` : "";
  const user = req.instruction.trim() ? `Pokyn uživatele: ${req.instruction.trim()}` : "";
  switch (req.mode) {
    case "cut":
      return `Navrhni střih: vyber segmenty, které mají ve videu zůstat. ${target}\n${user}`;
    case "highlights":
      return `Najdi nejsilnější samostatné momenty vhodné jako krátké klipy (Shorts/Reels/TikTok), typicky 15–60 s. Každý klip musí dávat smysl bez kontextu a začínat silnou větou. Seřaď je od nejlepšího. ${target}\n${user}`;
    case "metadata":
      return `Připrav podklady pro publikaci videa: návrhy názvu, popis, kapitoly (každá kapitola začíná na uvedeném segmentu, první kapitola na prvním segmentu) a tagy.\n${user}`;
  }
}

export class AIError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

export async function runEdit(req: EditRequest): Promise<CutPlan | HighlightPlan | MetadataPlan> {
  const schema = req.mode === "cut" ? CutPlan : req.mode === "highlights" ? HighlightPlan : MetadataPlan;
  let response;
  try {
    response = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Re-run on a fallback model automatically if a safety classifier declines the request.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(schema) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `<prepis>\n${formatTranscript(req.segments)}\n</prepis>\n\n${taskFor(req)}`,
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AIError("Neplatný nebo chybějící ANTHROPIC_API_KEY na serveru.", 401);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AIError("Claude API je přetížené (rate limit). Zkus to za chvíli.", 429);
    }
    if (err instanceof Anthropic.BadRequestError) {
      throw new AIError(`Claude API odmítlo požadavek: ${err.message}`, 400);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new AIError("Nepodařilo se spojit s Claude API.", 502);
    }
    if (err instanceof Anthropic.APIError) {
      throw new AIError(`Chyba Claude API: ${err.message}`, 502);
    }
    if (err instanceof Anthropic.AnthropicError) {
      // e.g. no credentials configured at all
      throw new AIError("Server nemá nastavený ANTHROPIC_API_KEY (soubor .env).", 401);
    }
    throw err;
  }

  if (response.stop_reason === "refusal") {
    throw new AIError("Model požadavek odmítl zpracovat.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new AIError("Odpověď modelu byla příliš dlouhá a byla useknuta. Zkus kratší video.", 502);
  }
  if (!response.parsed_output) throw new AIError("Model nevrátil platný plán střihu.", 502);
  return validate(response.parsed_output, req.segments);
}

/** Drop references to segments that don't exist and normalise reversed ranges. */
function validate<T extends CutPlan | HighlightPlan | MetadataPlan>(plan: T, segments: SegmentIn[]): T {
  const ids = new Set(segments.map((s) => s.i));
  const fix = <R extends { from: number; to: number }>(r: R): R | null => {
    const from = Math.min(r.from, r.to);
    const to = Math.max(r.from, r.to);
    return ids.has(from) && ids.has(to) ? { ...r, from, to } : null;
  };
  if ("keep" in plan) {
    return { ...plan, keep: plan.keep.map(fix).filter((r) => r !== null) };
  }
  if ("clips" in plan) {
    return { ...plan, clips: plan.clips.map(fix).filter((r) => r !== null) };
  }
  return { ...plan, chapters: plan.chapters.filter((c) => ids.has(c.segment)) };
}
