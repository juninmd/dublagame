import { FFMPEG, rendersDir, videoDir } from "./config";
import { db, type Cue } from "./db";

export type TakeInput = { file: string; offset: number; chars: string[] };

/** Une janelas coladas para nao gerar uma expressao gigante no ffmpeg. */
function duckWindows(cues: Cue[], chars: Set<string>) {
  const wins: [number, number][] = [];
  for (const c of cues.filter((c) => chars.has(c.char)).sort((a, b) => a.start - b.start)) {
    const last = wins[wins.length - 1];
    const s = Math.max(0, c.start - 0.15);
    const e = c.end + 0.15;
    if (last && s - last[1] < 0.4) last[1] = Math.max(last[1], e);
    else wins.push([s, e]);
  }
  return wins;
}

function buildFilter(cues: Cue[], takes: TakeInput[]) {
  const dubbed = new Set(takes.flatMap((t) => t.chars));
  const wins = duckWindows(cues, dubbed);
  const parts: string[] = [];

  // audio original abaixado enquanto o jogador fala
  const expr = wins.length
    ? wins.map(([s, e]) => `between(t,${s.toFixed(2)},${e.toFixed(2)})`).join("+")
    : "0";
  parts.push(`[0:a]volume=volume='if(${expr},0.14,1.0)':eval=frame[orig]`);

  const labels = ["[orig]"];
  takes.forEach((t, k) => {
    const idx = k + 1;
    // offset = instante do video (s) em que a gravacao comecou.
    // negativo (gravou antes de dar play) -> corta a cabeca; positivo -> atrasa.
    const off = Number.isFinite(t.offset) ? t.offset : 0;
    const align =
      off < -0.02
        ? `atrim=start=${(-off).toFixed(3)},asetpts=PTS-STARTPTS`
        : off > 0.02
          ? `adelay=${Math.round(off * 1000)}:all=1`
          : null;
    const chain = ["highpass=f=90", align, "acompressor=threshold=0.08:ratio=3:attack=8:release=180", "volume=1.5"]
      .filter(Boolean)
      .join(",");
    parts.push(`[${idx}:a]${chain}[dub${k}]`);
    labels.push(`[dub${k}]`);
  });

  parts.push(
    `${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,alimiter=limit=0.95[aout]`,
  );
  return parts.join(";");
}

export async function renderMix(videoId: string, renderId: string, takes: TakeInput[], cues: Cue[]) {
  const out = `${rendersDir(videoId)}/${renderId}.mp4`;
  const args = [
    "-y",
    "-i",
    `${videoDir(videoId)}/video.mp4`,
    ...takes.flatMap((t) => ["-i", t.file]),
    "-filter_complex",
    buildFilter(cues, takes),
    "-map",
    "0:v",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    out,
  ];

  const proc = Bun.spawn([FFMPEG, ...args], { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), 900_000);
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400));
  return out;
}

export function renderAsync(videoId: string, renderId: string, takes: TakeInput[], cues: Cue[]) {
  renderMix(videoId, renderId, takes, cues)
    .then((file) => db.query("UPDATE renders SET status='ready', file=? WHERE id=?").run(file, renderId))
    .catch((e: Error) =>
      db.query("UPDATE renders SET status='error', error=? WHERE id=?").run(e.message, renderId),
    );
}
