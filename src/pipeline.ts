import { readdirSync, readFileSync } from "node:fs";
import { MAX_DURATION_SEC, YTDLP, YTDLP_COOKIES, ensureDirs, videoDir } from "./config";
import { detectCharacters } from "./characters";
import { setVideo } from "./db";
import { parseJson3, parseVtt } from "./subs";

const SUB_LANGS = "pt-BR,pt,pt-orig,en,en-orig";

export function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    const v = u.searchParams.get("v");
    if (v) return v.slice(0, 11);
    const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

const cookieArgs = () => (YTDLP_COOKIES ? ["--cookies", YTDLP_COOKIES] : []);

async function run(cmd: string[], timeoutMs = 600_000) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code, stdout, stderr };
}

/** Escolhe a melhor legenda baixada: pt nativo > pt automatico > en. */
function pickSubtitle(dir: string) {
  const files = readdirSync(dir).filter((f) => /\.(json3|vtt|srt)$/.test(f));
  const rank = (f: string) => {
    const lang = f.match(/\.([\w-]+)\.(json3|vtt|srt)$/)?.[1] ?? "";
    const base = lang.startsWith("pt") ? 0 : lang.startsWith("en") ? 10 : 20;
    return base + (f.endsWith(".json3") ? 0 : 1) + (lang.includes("orig") ? -0.5 : 0);
  };
  const best = files.sort((a, b) => rank(a) - rank(b))[0];
  if (!best) return null;
  const raw = readFileSync(`${dir}/${best}`, "utf8");
  const lang = best.match(/\.([\w-]+)\.(json3|vtt|srt)$/)?.[1] ?? "??";
  return { cues: best.endsWith(".json3") ? parseJson3(raw) : parseVtt(raw), lang };
}

export async function ingest(id: string, url: string) {
  const dir = videoDir(id);
  ensureDirs(id);
  setVideo(id, { status: "downloading", error: null });

  const meta = await run([YTDLP, "--dump-json", "--no-playlist", ...cookieArgs(), url], 120_000);
  if (meta.code !== 0) throw new Error(`yt-dlp meta falhou: ${meta.stderr.trim().split("\n").pop()}`);
  const info = JSON.parse(meta.stdout) as { title?: string; duration?: number; is_live?: boolean };
  if (info.is_live) throw new Error("Transmissao ao vivo nao da para dublar.");
  const duration = info.duration ?? 0;
  if (duration > MAX_DURATION_SEC) {
    throw new Error(`Video de ${Math.round(duration / 60)}min — o limite e ${Math.round(MAX_DURATION_SEC / 60)}min.`);
  }
  setVideo(id, { title: info.title ?? id, duration });

  const dl = await run([
    YTDLP,
    "--no-playlist",
    "-f",
    "bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b",
    "--merge-output-format",
    "mp4",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    SUB_LANGS,
    "--sub-format",
    "json3/vtt/srt",
    "--no-warnings",
    ...cookieArgs(),
    "-o",
    `${dir}/video.%(ext)s`,
    url,
  ]);
  if (dl.code !== 0) throw new Error(`download falhou: ${dl.stderr.trim().split("\n").pop()}`);

  const sub = pickSubtitle(dir);
  if (!sub || sub.cues.length < 2) {
    throw new Error("Esse video nao tem legenda com tempo disponivel — escolha outro.");
  }

  const { characters, cues } = await detectCharacters(sub.cues, info.title ?? id);
  setVideo(id, {
    status: "ready",
    lang: sub.lang,
    characters: JSON.stringify(characters),
    cues: JSON.stringify(cues),
  });
}

const running = new Set<string>();

export function ingestAsync(id: string, url: string) {
  if (running.has(id)) return;
  running.add(id);
  ingest(id, url)
    .catch((e: Error) => setVideo(id, { status: "error", error: e.message.slice(0, 400) }))
    .finally(() => running.delete(id));
}
