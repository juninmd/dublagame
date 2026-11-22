import { describe, expect, test } from "bun:test";
import { parseJson3, parseVtt } from "../src/subs";

describe("parseVtt", () => {
  test("aceita tempos com horas (HH:MM:SS.mmm) e SRT com virgula", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nOla mundo\n\n2\n00:01:00,000 --> 00:01:02,000\nSegunda fala";
    const cues = parseVtt(vtt);
    expect(cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [1, 3.5, "Ola mundo"],
      [60, 62, "Segunda fala"],
    ]);
  });

  test("aceita WebVTT sem horas (MM:SS.mmm), que antes era descartado em silencio", () => {
    const cues = parseVtt("WEBVTT\n\n00:05.000 --> 00:08.250\nSem horas\n\n01:10.000 --> 01:12.000 align:start\nOutra <c>fala</c>");
    expect(cues.map((c) => [c.start, c.end, c.text])).toEqual([
      [5, 8.25, "Sem horas"],
      [70, 72, "Outra fala"],
    ]);
  });

  test("ignora blocos sem tempo e distribui as palavras no intervalo", () => {
    const cues = parseVtt("WEBVTT\n\nNOTE comentario\n\n00:00:00.000 --> 00:00:04.000\num dois tres quatro");
    expect(cues).toHaveLength(1);
    expect(cues[0].words.map((w) => w.t)).toEqual([0, 1, 2, 3]);
  });
  test("mantem linhas de fala so com numeros; so o identificador antes do tempo e descartado", () => {
    const cues = parseVtt("WEBVTT\n\n7\n00:00:01.000 --> 00:00:04.000\nO ano foi\n1999\n\n00:00:05.000 --> 00:00:07.000\n42");
    expect(cues.map((c) => c.text)).toEqual(["O ano foi 1999", "42"]);
  });

  test("decodifica as entidades do WebVTT em vez de mostrar &amp; na tela", () => {
    const cues = parseVtt("WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nTom &amp; Jerry &lt;3&nbsp;ok &#39;sim&#x27;");
    expect(cues[0].text).toBe("Tom & Jerry <3 ok 'sim'");
    expect(cues[0].words.map((w) => w.w)).toEqual(["Tom", "&", "Jerry", "<3", "ok", "'sim'"]);
  });

  test("nomes que nao sao entidades, como &constructor;, ficam como estao", () => {
    const cues = parseVtt("WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nisso &constructor; e &toString; ok &amp;");
    expect(cues[0].text).toBe("isso &constructor; e &toString; ok &");
  });
});

describe("parseJson3", () => {
  const ev = (tStartMs: number, dDurationMs: number, text: string, extra = {}) => ({
    tStartMs,
    dDurationMs,
    segs: [{ utf8: text }],
    ...extra,
  });

  test("descarta eventos aAppend e rotulos como [Music]", () => {
    const raw = JSON.stringify({ events: [ev(0, 3000, "hello there"), ev(3000, 100, "\n", { aAppend: 1 }), ev(4000, 2000, "[Music]")] });
    const cues = parseJson3(raw);
    expect(cues.map((c) => c.text)).toEqual(["hello there"]);
  });

  test("junta falas curtas coladas na anterior", () => {
    const raw = JSON.stringify({ events: [ev(0, 3000, "first part"), ev(3100, 800, "and more")] });
    const cues = parseJson3(raw);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("first part and more");
    expect(cues[0].end).toBeCloseTo(3.9);
  });
});
