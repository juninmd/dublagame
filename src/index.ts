import { Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import { PORT, ensureDirs, rendersDir, takesDir, videoDir } from "./config";
import { db, getVideo, listVideos, setVideo, upsertVideo, type Character, type Cue } from "./db";
import { ingestAsync, youtubeId } from "./pipeline";
import { renderAsync, type TakeInput } from "./render";
import { mkChar } from "./characters";

const app = new Hono();
const rid = () => crypto.randomUUID().slice(0, 8);

/** Streaming com Range — sem isso o <video> nao busca posicao no Chrome. */
function serveFile(path: string, req: Request, type: string) {
  if (!existsSync(path)) return new Response("not found", { status: 404 });
  const size = statSync(path).size;
  const range = req.headers.get("range");
  const base = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-cache" };
  if (!range) return new Response(Bun.file(path), { headers: { ...base, "content-length": String(size) } });

  const m = range.match(/bytes=(\d*)-(\d*)/);
  const start = m?.[1] ? Number(m[1]) : 0;
  const end = m?.[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    return new Response("range", { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  return new Response(Bun.file(path).slice(start, end + 1), {
    status: 206,
    headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
  });
}

const page = (name: string) => (c: { req: { raw: Request } }) =>
  serveFile(`${import.meta.dir}/../public/${name}`, c.req.raw, "text/html; charset=utf-8");

app.get("/", page("index.html"));
app.get("/jogar/:id", page("play.html"));
app.get("/healthz", (c) => c.json({ ok: true }));

app.get("/assets/:file", (c) => {
  const file = c.req.param("file").replace(/[^\w.-]/g, "");
  const type = file.endsWith(".css") ? "text/css" : "text/javascript";
  return serveFile(`${import.meta.dir}/../public/${file}`, c.req.raw, `${type}; charset=utf-8`);
});

app.post("/api/videos", async (c) => {
  const { url } = (await c.req.json()) as { url?: string };
  const id = youtubeId(url ?? "");
  if (!id) return c.json({ error: "URL do YouTube invalida" }, 400);

  const existing = getVideo(id);
  if (existing?.status === "ready") return c.json({ id, status: "ready" });
  if (!existing) upsertVideo(id, url!);
  else if (existing.status === "error") setVideo(id, { status: "pending", error: null });
  ingestAsync(id, `https://www.youtube.com/watch?v=${id}`);
  return c.json({ id, status: "pending" });
});

app.get("/api/videos", (c) => c.json(listVideos()));

app.get("/api/videos/:id", (c) => {
  const v = getVideo(c.req.param("id"));
  if (!v) return c.json({ error: "nao encontrado" }, 404);
  const takes = db
    .query("SELECT id, player, characters, score, created_at FROM takes WHERE video_id = ? ORDER BY created_at")
    .all(v.id) as { id: string; player: string; characters: string; score: number }[];
  return c.json({
    id: v.id,
    title: v.title,
    duration: v.duration,
    status: v.status,
    error: v.error,
    lang: v.lang,
    characters: v.characters ? (JSON.parse(v.characters) as Character[]) : [],
    cues: v.cues ? (JSON.parse(v.cues) as Cue[]) : [],
    takes: takes.map((t) => ({ ...t, characters: JSON.parse(t.characters) as string[] })),
  });
});

/** Editor de elenco: renomear/criar personagem e reatribuir falas. */
app.put("/api/videos/:id/cast", async (c) => {
  const v = getVideo(c.req.param("id"));
  if (!v?.cues) return c.json({ error: "nao encontrado" }, 404);
  const body = (await c.req.json()) as { names?: Record<string, string>; assign?: Record<string, string> };

  let characters = JSON.parse(v.characters ?? "[]") as Character[];
  for (const [id, name] of Object.entries(body.names ?? {})) {
    const clean = name.trim().slice(0, 24);
    if (!clean) continue;
    const found = characters.find((x) => x.id === id);
    if (found) found.name = clean;
    else characters.push({ ...mkChar(characters.length), id, name: clean });
  }
  characters = characters.slice(0, 6);

  const ids = new Set(characters.map((x) => x.id));
  const cues = (JSON.parse(v.cues) as Cue[]).map((cue) => {
    const next = body.assign?.[String(cue.i)];
    return next && ids.has(next) ? { ...cue, char: next } : cue;
  });

  setVideo(v.id, { characters: JSON.stringify(characters), cues: JSON.stringify(cues) });
  return c.json({ characters, cues });
});

app.get("/media/:id/video.mp4", (c) =>
  serveFile(`${videoDir(c.req.param("id").replace(/[^\w-]/g, ""))}/video.mp4`, c.req.raw, "video/mp4"),
);

app.post("/api/videos/:id/takes", async (c) => {
  const v = getVideo(c.req.param("id"));
  if (v?.status !== "ready") return c.json({ error: "video nao esta pronto" }, 400);

  const form = await c.req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return c.json({ error: "audio ausente" }, 400);
  if (audio.size > 120 * 1024 * 1024) return c.json({ error: "audio grande demais" }, 413);

  const chars = String(form.get("characters") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!chars.length) return c.json({ error: "escolha um personagem" }, 400);

  ensureDirs(v.id);
  const id = rid();
  const file = `${takesDir(v.id)}/${id}.webm`;
  await Bun.write(file, audio);

  db.query(
    "INSERT INTO takes (id, video_id, player, characters, file, offset_sec, score, detail, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    v.id,
    String(form.get("player") ?? "Jogador").slice(0, 24),
    JSON.stringify(chars),
    file,
    Number(form.get("offset") ?? 0),
    Number(form.get("score") ?? 0),
    String(form.get("detail") ?? "[]").slice(0, 20000),
    Date.now(),
  );
  return c.json({ id });
});

app.delete("/api/takes/:id", (c) => {
  db.query("DELETE FROM takes WHERE id = ?").run(c.req.param("id"));
  return c.json({ ok: true });
});

app.post("/api/videos/:id/render", async (c) => {
  const v = getVideo(c.req.param("id"));
  if (v?.status !== "ready" || !v.cues) return c.json({ error: "video nao esta pronto" }, 400);
  const { takeIds } = (await c.req.json()) as { takeIds?: string[] };
  if (!takeIds?.length) return c.json({ error: "nenhuma dublagem selecionada" }, 400);

  const rows = db
    .query(
      `SELECT id, file, offset_sec, characters FROM takes WHERE video_id = ? AND id IN (${takeIds.map(() => "?").join(",")})`,
    )
    .all(v.id, ...takeIds) as { file: string; offset_sec: number; characters: string }[];
  if (!rows.length) return c.json({ error: "dublagens nao encontradas" }, 404);

  const takes: TakeInput[] = rows.map((r) => ({
    file: r.file,
    offset: r.offset_sec,
    chars: JSON.parse(r.characters) as string[],
  }));

  ensureDirs(v.id);
  const id = rid();
  db.query("INSERT INTO renders (id, video_id, status, created_at) VALUES (?,?,'rendering',?)").run(
    id,
    v.id,
    Date.now(),
  );
  renderAsync(v.id, id, takes, JSON.parse(v.cues) as Cue[]);
  return c.json({ id, status: "rendering" });
});

app.get("/api/renders/:id", (c) => {
  const r = db.query("SELECT id, video_id, status, error FROM renders WHERE id = ?").get(c.req.param("id")) as
    | { id: string; video_id: string; status: string; error: string | null }
    | null;
  if (!r) return c.json({ error: "nao encontrado" }, 404);
  return c.json({ ...r, url: r.status === "ready" ? `/media/${r.video_id}/render/${r.id}.mp4` : null });
});

app.get("/media/:id/render/:file", (c) => {
  const id = c.req.param("id").replace(/[^\w-]/g, "");
  const file = c.req.param("file").replace(/[^\w.-]/g, "");
  return serveFile(`${rendersDir(id)}/${file}`, c.req.raw, "video/mp4");
});

console.log(`dublagame on :${PORT}`);
export default { port: PORT, fetch: app.fetch, idleTimeout: 120 };
