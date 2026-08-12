/**
 * Smoke E2E: usa o microfone falso do Chromium para jogar uma partida inteira
 * (karaoke -> gravacao -> pontuacao -> upload -> render) contra um servidor ja no ar.
 *
 *   bun test/smoke.mjs [baseUrl] [youtubeUrl]
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3777";
const ytUrl = process.argv[3] ?? "https://youtu.be/jNQXAC9IVRw";
const errors = [];
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) errors.push(label);
};

const api = async (path, init) => {
  const res = await fetch(base + path, init);
  return { status: res.status, body: await res.json().catch(() => null) };
};

// 1. ingest
const created = await api("/api/videos", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ url: ytUrl }),
});
ok("POST /api/videos aceita a URL", created.status === 200, JSON.stringify(created.body));
const id = created.body?.id;

let video = null;
for (let i = 0; i < 90 && !video; i++) {
  const { body } = await api(`/api/videos/${id}`);
  if (body?.status === "ready") video = body;
  else if (body?.status === "error") throw new Error(`ingest falhou: ${body.error}`);
  else await new Promise((r) => setTimeout(r, 2000));
}
ok("video fica ready com legenda", Boolean(video), `${video?.cues.length} falas, lang=${video?.lang}`);
ok("cues tem tempo por palavra", video.cues.every((c) => c.words.length >= 1 && c.words[0].t >= c.start - 0.01));

// 2. partida real no browser, com microfone falso
const browser = await chromium.launch({
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const ctx = await browser.newContext({ permissions: ["microphone"] });
const page = await ctx.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && jsErrors.push(m.text()));

await page.goto(`${base}/jogar/${id}`);
await page.waitForFunction(() => document.querySelectorAll("#cast input").length > 0, { timeout: 15000 });
ok("sala carrega o elenco", (await page.locator("#cast input").count()) > 0);

await page.fill("#player", "Robo QA");
await page.locator("#cast input").first().check();
ok("botao gravar libera ao escolher personagem", !(await page.locator("#start").isDisabled()));

await page.click("#start");
await page.waitForFunction(() => !document.querySelector("video").paused, { timeout: 20000 });
ok("video toca depois da contagem", true);

// karaoke marcando palavra durante a primeira fala
await page.waitForFunction(() => document.querySelectorAll("#cueNow .w.on").length > 0, { timeout: 20000 });
ok("karaoke acende as palavras no tempo", true);

const dur = video.duration ?? 20;
await page.waitForFunction(() => document.querySelector("#start").hidden === false, {
  timeout: (dur + 30) * 1000,
});
const shown = await page.locator("#msg").textContent();
ok("take enviado ao fim do video", /nota \d+\/100/.test(shown ?? ""), shown ?? "");

const scored = Number((shown ?? "").match(/nota (\d+)/)?.[1] ?? -1);
ok("pontuacao calculada a partir do audio", scored >= 0 && scored <= 100, `score=${scored}`);
ok("sem erro de JS na pagina", jsErrors.length === 0, jsErrors.join(" | ").slice(0, 200));

// 3. render do mp4 dublado
const takes = (await api(`/api/videos/${id}`)).body.takes;
ok("take persistido", takes.length > 0, `${takes.length} take(s)`);

const r = await api(`/api/videos/${id}/render`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ takeIds: [takes[takes.length - 1].id] }),
});
let render = null;
for (let i = 0; i < 90 && !render; i++) {
  const { body } = await api(`/api/renders/${r.body.id}`);
  if (body.status === "ready") render = body;
  else if (body.status === "error") throw new Error(`render falhou: ${body.error}`);
  else await new Promise((res) => setTimeout(res, 2000));
}
const head = await fetch(base + render.url, { headers: { range: "bytes=0-1023" } });
ok("mp4 dublado servido com range", head.status === 206, `${head.headers.get("content-range")}`);

await browser.close();
console.log(errors.length ? `\n${errors.length} FALHA(S)` : "\ntudo verde");
process.exit(errors.length ? 1 : 0);
