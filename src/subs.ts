import type { Cue } from "./db";

type Json3Seg = { utf8: string; tOffsetMs?: number };
type Json3Event = { tStartMs?: number; dDurationMs?: number; aAppend?: number; segs?: Json3Seg[] };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Distribui palavras uniformemente quando a legenda nao tem tempo por palavra. */
const spread = (tokens: string[], start: number, end: number) => {
  const step = (end - start) / Math.max(tokens.length, 1);
  return tokens.map((w, k) => ({ t: start + k * step, w }));
};

/**
 * Legendas automaticas do YouTube vem em "rollup": eventos com aAppend repetem
 * o texto anterior. Ficamos so com os eventos completos (tem duracao e texto).
 */
export function parseJson3(raw: string): Cue[] {
  const data = JSON.parse(raw) as { events?: Json3Event[] };
  const cues: Cue[] = [];

  for (const ev of data.events ?? []) {
    if (ev.aAppend || !ev.segs || ev.tStartMs == null) continue;
    const start = ev.tStartMs / 1000;
    const words = ev.segs
      .filter((s) => s.utf8 && clean(s.utf8))
      .map((s) => ({ t: start + (s.tOffsetMs ?? 0) / 1000, w: clean(s.utf8) }));
    const text = clean(words.map((w) => w.w).join(" "));
    if (!text || /^\[[^\]]*\]$/.test(text)) continue; // [Music], [Applause]...
    const end = start + (ev.dDurationMs ?? 2000) / 1000;
    // faixa sem timing por palavra (seg unico com a frase toda): distribui no intervalo
    const tokens = text.split(" ");
    const timed = words.length >= tokens.length ? words : spread(tokens, start, end);
    cues.push({ i: cues.length, start, end, text, words: timed, char: "c1" });
  }
  return mergeShort(cues);
}

// WebVTT permite omitir as horas (MM:SS.mmm); o SRT sempre traz HH:MM:SS,mmm.
const TS = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})/g;

// Entidades que o WebVTT define, mais as numericas (&#39; aparece em legendas do YouTube).
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", nbsp: "\u00a0", lrm: "\u200e", rlm: "\u200f", quot: '"', apos: "'" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") {
      const name = e.toLowerCase();
      // Object.hasOwn: "constructor" e afins sao herdados de Object.prototype, nao entidades.
      return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : m;
    }
    const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });

/** Fallback para legendas manuais em .vtt/.srt (sem timing por palavra). */
export function parseVtt(raw: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of raw.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block.split("\n").filter(Boolean);
    const at = lines.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const timeLine = lines[at];
    const stamps = [...timeLine.matchAll(TS)].map(
      (m) => +(m[1] ?? 0) * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000,
    );
    if (stamps.length < 2) continue;
    // So o que vem antes do tempo e identificador/cabecalho; uma fala "1999" e texto.
    const text = clean(
      decodeEntities(
        lines
          .slice(at + 1)
          .join(" ")
          .replace(/<[^>]+>/g, ""),
      ),
    );
    if (!text) continue;
    const [start, end] = stamps;
    cues.push({ i: cues.length, start, end, text, words: spread(text.split(" "), start, end), char: "c1" });
  }
  return mergeShort(cues);
}

/** Junta cues muito curtas/coladas — ler uma palavra solta em karaoke e ruim. */
function mergeShort(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    const prev = out[out.length - 1];
    const tooShort = c.end - c.start < 1.2;
    const glued = prev && c.start - prev.end < 0.35;
    if (prev && tooShort && glued && prev.end - prev.start < 8) {
      prev.end = c.end;
      prev.text = `${prev.text} ${c.text}`;
      prev.words.push(...c.words);
    } else {
      out.push({ ...c, i: out.length });
    }
  }
  return out.map((c, i) => ({ ...c, i }));
}
