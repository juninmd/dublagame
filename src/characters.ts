import { AI } from "./config";
import type { Character, Cue } from "./db";

const PALETTE = ["#ff5d73", "#4cc9f0", "#ffd166", "#8ac926", "#c77dff", "#ff9f1c"];

export const mkChar = (i: number, name?: string): Character => ({
  id: `c${i + 1}`,
  name: name ?? `Personagem ${i + 1}`,
  color: PALETTE[i % PALETTE.length],
});

/** Legenda manual costuma marcar quem fala: "NOME: fala" ou "- fala". */
function bySpeakerPrefix(cues: Cue[]): { characters: Character[]; cues: Cue[] } | null {
  const names = new Map<string, string>();
  let tagged = 0;
  for (const c of cues) {
    const m = c.text.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' .]{1,18}?)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    if (!names.has(key)) names.set(key, m[1].trim());
    tagged++;
  }
  if (tagged < cues.length * 0.5 || names.size < 2 || names.size > 6) return null;

  const order = [...names.values()];
  const characters = order.map((n, i) => mkChar(i, n));
  let last = characters[0].id;
  const out = cues.map((c) => {
    const m = c.text.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' .]{1,18}?)\s*:\s*(.+)$/);
    if (!m) return { ...c, char: last };
    const idx = order.findIndex((n) => n.toLowerCase() === m[1].trim().toLowerCase());
    last = characters[Math.max(idx, 0)].id;
    const text = m[2].trim();
    const drop = c.text.length - text.length;
    return {
      ...c,
      text,
      char: last,
      words: c.words.filter((_, k) => k > 0 || drop === 0),
    };
  });
  return { characters, cues: out };
}

type AiOut = { characters: { id: string; name: string }[]; lines: { i: number; c: string }[] };

async function byAi(cues: Cue[], title: string): Promise<{ characters: Character[]; cues: Cue[] } | null> {
  if (!AI.enabled || cues.length < 4) return null;
  const sample = cues.map((c) => `${c.i}|${c.start.toFixed(1)}s|${c.text}`).join("\n");
  const prompt = `Voce recebe a transcricao automatica (sem marcacao de quem fala) do video "${title}".
Agrupe as falas por personagem/voz provavel (no maximo 4 personagens). Use as pausas, o vocativo e o contexto.
Se for claramente uma unica voz (narracao, aula, musica solo), devolva 1 personagem.
Responda SO JSON: {"characters":[{"id":"c1","name":"..."}],"lines":[{"i":0,"c":"c1"}]} cobrindo todas as linhas.

${sample}`;

  try {
    const res = await fetch(`${AI.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${AI.key}` },
      body: JSON.stringify({
        model: AI.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content ?? "";
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as AiOut;
    if (!parsed.characters?.length || !parsed.lines?.length) return null;

    const characters = parsed.characters.slice(0, 6).map((c, i) => mkChar(i, c.name?.slice(0, 24)));
    const byId = new Map(parsed.characters.slice(0, 6).map((c, i) => [c.id, characters[i].id]));
    const map = new Map(parsed.lines.map((l) => [l.i, byId.get(l.c) ?? characters[0].id]));
    return { characters, cues: cues.map((c) => ({ ...c, char: map.get(c.i) ?? characters[0].id })) };
  } catch {
    return null;
  }
}

/** Sempre devolve algo utilizavel; a UI permite reatribuir falas na mao. */
export async function detectCharacters(cues: Cue[], title: string) {
  return (
    bySpeakerPrefix(cues) ??
    (await byAi(cues, title)) ?? { characters: [mkChar(0)], cues: cues.map((c) => ({ ...c, char: "c1" })) }
  );
}
