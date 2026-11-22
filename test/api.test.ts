import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "dublagame-"));
process.env.DATA_DIR = dir;

let app: { fetch: (r: Request) => Response | Promise<Response> };
let db: typeof import("../src/db");

beforeAll(async () => {
  db = await import("../src/db");
  app = (await import("../src/index")).default;
  db.upsertVideo("vid00000001", "https://youtu.be/vid00000001");
  db.setVideo("vid00000001", {
    status: "ready",
    characters: JSON.stringify([{ id: "c1", name: "A", color: "#fff" }]),
    cues: JSON.stringify([{ i: 0, start: 0, end: 1, text: "oi", words: [], char: "c1" }]),
  });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const put = (body: BodyInit, type = "application/json") =>
  app.fetch(new Request("http://x/api/videos/vid00000001/cast", { method: "PUT", body, headers: { "content-type": type } }));

test("PUT cast com JSON invalido responde 400 em vez de 500", async () => {
  expect((await put("{nope")).status).toBe(400);
  expect((await put("[1]")).status).toBe(400);
});

test("PUT cast ignora nomes que nao sao string", async () => {
  const res = await put(JSON.stringify({ names: { c1: 42, c2: "  Bia  " } }));
  expect(res.status).toBe(200);
  const { characters } = (await res.json()) as { characters: { id: string; name: string }[] };
  expect(characters.map((c) => c.name)).toEqual(["A", "Bia"]);
});

test("POST takes sem multipart responde 400 em vez de 500", async () => {
  const res = await app.fetch(
    new Request("http://x/api/videos/vid00000001/takes", { method: "POST", body: "x", headers: { "content-type": "text/plain" } }),
  );
  expect(res.status).toBe(400);
});

const range = (value: string) =>
  app.fetch(new Request("http://x/assets/app.css", { headers: { range: value } }));

test("Range de sufixo (bytes=-N) entrega os ultimos N bytes, como manda a RFC 9110", async () => {
  const full = await (await app.fetch(new Request("http://x/assets/app.css"))).text();
  const size = Buffer.byteLength(full);
  const res = await range("bytes=-10");
  expect(res.status).toBe(206);
  expect(res.headers.get("content-range")).toBe(`bytes ${size - 10}-${size - 1}/${size}`);
  expect(await res.text()).toBe(full.slice(-10));
  // sufixo maior que o arquivo entrega o arquivo inteiro; sufixo zero nao e satisfazivel
  expect((await range(`bytes=-${size + 50}`)).headers.get("content-range")).toBe(`bytes 0-${size - 1}/${size}`);
  expect((await range("bytes=-0")).status).toBe(416);
});

test("Range com inicio e fim continua igual", async () => {
  const res = await range("bytes=0-4");
  expect(res.status).toBe(206);
  expect((await res.text()).length).toBe(5);
});

test("Range invalido e ignorado: 200 com o arquivo inteiro, nao 206", async () => {
  const full = await (await app.fetch(new Request("http://x/assets/app.css"))).text();
  for (const value of ["items=0-5", "bytes=abc", "bytes=-", "bytes = 0-4"]) {
    const res = await range(value);
    expect(res.status, value).toBe(200);
    expect(res.headers.get("content-range"), value).toBeNull();
    expect(await res.text(), value).toBe(full);
  }
});
