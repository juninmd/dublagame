const $ = (s) => document.querySelector(s);
const videoId = location.pathname.split("/").pop();
const video = $("#video");

let data = null;
let mine = new Set();
let session = null; // { rec, chunks, samples, offset, cursor, score[], combo }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const charById = (id) => data.characters.find((c) => c.id === id);
const msg = (el, text, kind = "info") => {
  el.hidden = !text;
  el.textContent = text;
  el.className = `status ${kind}`;
};

/* ---------- carga ---------- */

async function load() {
  data = await (await fetch(`/api/videos/${videoId}`)).json();
  if (data.error || data.status !== "ready") {
    msg($("#msg"), data.error ?? "vídeo ainda não está pronto", "err");
    return;
  }
  $("#title").textContent = data.title ?? videoId;
  $("#lang").textContent = `legenda ${data.lang ?? "?"} · ${data.cues.length} falas`;
  video.src = `/media/${videoId}/video.mp4`;
  video.volume = 0.55;
  $("#player").value = localStorage.getItem("dg_player") ?? "";
  renderCast();
  renderEditor();
  renderBoard();
}

function renderCast() {
  const counts = new Map();
  for (const c of data.cues) counts.set(c.char, (counts.get(c.char) ?? 0) + 1);

  $("#cast").innerHTML = data.characters
    .map(
      (c) => `<label class="chip" style="--c:${c.color}">
        <input type="checkbox" value="${c.id}" ${mine.has(c.id) ? "checked" : ""} />
        <b>${c.name}</b><em>${counts.get(c.id) ?? 0} falas</em></label>`,
    )
    .join("");

  for (const el of document.querySelectorAll("#cast input")) {
    el.addEventListener("change", () => {
      el.checked ? mine.add(el.value) : mine.delete(el.value);
      $("#start").disabled = mine.size === 0;
      $("#whoBadge").textContent = [...mine].map((id) => charById(id)?.name).join(" + ");
    });
  }
  $("#start").disabled = mine.size === 0;
}

function renderEditor() {
  $("#editor").innerHTML = data.cues
    .map(
      (c) => `<div class="line">
        <span class="t">${c.start.toFixed(1)}s</span>
        <select data-i="${c.i}">${data.characters
          .map((ch) => `<option value="${ch.id}" ${ch.id === c.char ? "selected" : ""}>${ch.name}</option>`)
          .join("")}<option value="__new">+ novo personagem</option></select>
        <span class="txt">${c.text}</span>
      </div>`,
    )
    .join("");

  for (const sel of document.querySelectorAll("#editor select")) {
    sel.addEventListener("change", () => {
      if (sel.value !== "__new") return;
      const name = prompt("Nome do personagem:");
      if (!name) return (sel.value = data.cues[+sel.dataset.i].char);
      const id = `c${data.characters.length + 1}`;
      data.characters.push({ id, name, color: "#c77dff" });
      renderCast();
      renderEditor();
    });
  }
}

$("#saveCast").addEventListener("click", async () => {
  const assign = {};
  for (const sel of document.querySelectorAll("#editor select")) {
    if (sel.value !== "__new") assign[sel.dataset.i] = sel.value;
  }
  const names = Object.fromEntries(data.characters.map((c) => [c.id, c.name]));
  const res = await fetch(`/api/videos/${videoId}/cast`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ names, assign }),
  });
  const out = await res.json();
  data.characters = out.characters;
  data.cues = out.cues;
  renderCast();
  renderEditor();
  msg($("#msg"), "elenco salvo ✓");
  setTimeout(() => msg($("#msg"), ""), 2000);
});

/* ---------- karaoke ---------- */

const myCues = () => data.cues.filter((c) => mine.has(c.char));

function paint(t) {
  const cues = data.cues;
  const active = cues.find((c) => t >= c.start - 0.05 && t <= c.end + 0.25);
  const next = cues.find((c) => c.start > t);
  const now = $("#cueNow");

  if (active) {
    const ch = charById(active.char);
    const isMine = mine.has(active.char);
    now.className = `cue-now ${isMine ? "mine" : "other"}`;
    now.style.setProperty("--c", ch?.color ?? "#fff");
    now.innerHTML =
      (isMine ? "" : `<span class="who">${ch?.name}: </span>`) +
      active.words
        .map((w, k) => {
          const nextT = active.words[k + 1]?.t ?? active.end;
          const on = t >= w.t - 0.05;
          const cur = on && t < nextT;
          return `<span class="w ${on ? "on" : ""} ${cur ? "cur" : ""}">${w.w}</span>`;
        })
        .join(" ");
    const p = clamp((t - active.start) / Math.max(active.end - active.start, 0.1), 0, 1);
    $("#timerFill").style.width = `${p * 100}%`;
    $("#timerFill").className = isMine ? "mine" : "";
  } else if (next) {
    const ch = charById(next.char);
    const inSec = next.start - t;
    const isMine = mine.has(next.char);
    now.className = "cue-now waiting";
    now.innerHTML = isMine
      ? `<span class="prep">tua vez em ${inSec.toFixed(1)}s</span><br />${next.text}`
      : `<span class="prep">${ch?.name} fala em ${inSec.toFixed(1)}s</span>`;
    $("#timerFill").style.width = `${clamp(1 - inSec / 3, 0, 1) * 100}%`;
    $("#timerFill").className = isMine ? "prep" : "";
  } else {
    now.className = "cue-now";
    now.textContent = "fim das falas 🎉";
    $("#timerFill").style.width = "0%";
  }

  const upcoming = cues.filter((c) => c.start > t && mine.has(c.char))[0];
  $("#cueNext").textContent = upcoming && upcoming !== active ? `→ ${upcoming.text}` : "";

  // silencia o original enquanto o teu personagem fala: a voz dele nao pode
  // competir com a tua nem vazar no microfone. Margem cobre o rabo da fala.
  const base = Number($("#vol").value) / 100;
  const mineTalking = data.cues.some(
    (c) => mine.has(c.char) && t >= c.start - 0.25 && t <= c.end + 0.25,
  );
  video.volume = mineTalking && !$("#practice").checked ? 0 : base;
}

let rafId = 0;
function loop() {
  paint(video.currentTime);
  if (session) grade(video.currentTime);
  rafId = requestAnimationFrame(loop);
}

/* ---------- pontuacao ---------- */

function levelsIn(samples, a, b) {
  return samples.filter((s) => s.t >= a && s.t <= b);
}

function threshold(samples) {
  if (samples.length < 10) return 0.02;
  const sorted = samples.map((s) => s.v).sort((x, y) => x - y);
  const floor = sorted[Math.floor(sorted.length * 0.2)];
  return Math.max(floor * 3, 0.012);
}

function scoreCue(cue, samples) {
  const thr = threshold(samples);
  const win = levelsIn(samples, cue.start - 0.35, cue.end + 0.35);
  if (!win.length) return { score: 0, voiced: 0, delay: 0 };
  const voicedArr = win.filter((s) => s.v > thr);
  const voiced = voicedArr.length / win.length;
  const first = voicedArr[0]?.t ?? cue.start + 2;
  const delay = first - cue.start;
  const timing = clamp(1 - Math.abs(delay) / 1.2, 0, 1);
  const fill = clamp(voiced / 0.6, 0, 1);
  return { score: Math.round(100 * (0.65 * fill + 0.35 * timing)), voiced, delay };
}

function grade(t) {
  const s = session;
  const list = s.myCues;
  while (s.cursor < list.length && t > list[s.cursor].end + 0.4) {
    const cue = list[s.cursor++];
    const r = scoreCue(cue, s.samples);
    s.results.push({ i: cue.i, ...r });
    s.combo = r.score >= 60 ? s.combo + 1 : 0;
    s.total += r.score * (1 + Math.min(s.combo, 5) * 0.05);
    flash(r.score, s.combo);
    $("#score").textContent = Math.round(s.total);
    $("#combo").textContent = s.combo > 1 ? `🔥 x${s.combo}` : "";
  }
}

function flash(score, combo) {
  const el = document.createElement("div");
  el.className = `pop ${score >= 80 ? "great" : score >= 55 ? "ok" : "bad"}`;
  el.textContent = `${score >= 80 ? "PERFEITO" : score >= 55 ? "BOA" : "FRACO"} +${score}${combo > 1 ? ` x${combo}` : ""}`;
  $("#hud").appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

/* ---------- gravacao ---------- */

async function start() {
  const practice = $("#practice").checked;
  $("#start").hidden = true;
  $("#stop").hidden = false;
  $("#hud").hidden = false;
  $("#score").textContent = "0";
  $("#whoBadge").textContent = [...mine].map((id) => charById(id)?.name).join(" + ");

  let rec = null;
  let stream = null;
  const samples = [];
  let recStart = 0;

  if (!practice) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      msg($("#msg"), "sem acesso ao microfone — liga a permissão ou usa o modo treino", "err");
      return reset();
    }
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    const tick = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const x of buf) sum += x * x;
      samples.push({ t: video.currentTime, v: Math.sqrt(sum / buf.length) });
    }, 40);

    rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    session = { rec, stream, ctx, tick, chunks: [], samples, cursor: 0, results: [], total: 0, combo: 0, myCues: myCues(), offset: 0 };
    rec.ondataavailable = (e) => e.data.size && session.chunks.push(e.data);
    rec.start(1000);
    recStart = performance.now();
  } else {
    session = { chunks: [], samples, cursor: 0, results: [], total: 0, combo: 0, myCues: myCues(), offset: 0, practice: true };
  }

  await countdown(3);
  video.currentTime = 0;
  await video.play();
  session.offset = recStart ? (recStart - performance.now()) / 1000 : 0;
  loop();
  video.onended = () => finish();
}

function countdown(n) {
  const el = $("#countdown");
  el.hidden = false;
  return new Promise((done) => {
    const step = () => {
      el.textContent = n > 0 ? n : "🎬";
      if (n-- < 0) {
        el.hidden = true;
        return done();
      }
      setTimeout(step, 700);
    };
    step();
  });
}

function reset() {
  $("#start").hidden = false;
  $("#stop").hidden = true;
  $("#hud").hidden = true;
  cancelAnimationFrame(rafId);
  session = null;
}

async function finish() {
  const s = session;
  if (!s) return;
  video.pause();
  cancelAnimationFrame(rafId);
  clearInterval(s.tick);

  if (s.practice) {
    msg($("#msg"), `treino: ${Math.round(s.total)} pontos (nada foi gravado)`);
    return reset();
  }

  const blob = await new Promise((res) => {
    s.rec.onstop = () => res(new Blob(s.chunks, { type: "audio/webm" }));
    s.rec.state !== "inactive" ? s.rec.stop() : res(new Blob(s.chunks, { type: "audio/webm" }));
  });
  s.stream.getTracks().forEach((t) => t.stop());
  s.ctx.close();

  // reavalia com a amostragem completa
  const results = s.myCues.map((c) => ({ i: c.i, ...scoreCue(c, s.samples) }));
  const avg = results.length ? results.reduce((a, r) => a + r.score, 0) / results.length : 0;

  const fd = new FormData();
  fd.append("audio", blob, "take.webm");
  fd.append("player", $("#player").value.trim() || "Jogador");
  fd.append("characters", [...mine].join(","));
  fd.append("offset", String(s.offset));
  fd.append("score", String(Math.round(avg)));
  fd.append("detail", JSON.stringify(results));
  localStorage.setItem("dg_player", $("#player").value.trim());

  msg($("#msg"), "enviando dublagem…");
  const res = await fetch(`/api/videos/${videoId}/takes`, { method: "POST", body: fd });
  const out = await res.json();
  msg($("#msg"), res.ok ? `dublagem salva — nota ${Math.round(avg)}/100 🎉` : out.error, res.ok ? "ok" : "err");
  reset();
  await load();
}

$("#start").addEventListener("click", start);
$("#stop").addEventListener("click", finish);
$("#vol").addEventListener("input", () => (video.volume = Number($("#vol").value) / 100));

/* ---------- placar + render ---------- */

function renderBoard() {
  const takes = data.takes ?? [];
  $("#render").disabled = takes.length === 0;
  if (!takes.length) return ($("#board").innerHTML = `<li class="empty">ninguém dublou ainda</li>`);

  $("#board").innerHTML = [...takes]
    .sort((a, b) => b.score - a.score)
    .map(
      (t, k) => `<li>
        <input type="checkbox" class="pick" value="${t.id}" checked />
        <span class="pos">${k + 1}º</span>
        <b>${t.player}</b>
        <em>${t.characters.map((c) => charById(c)?.name ?? c).join(", ")}</em>
        <span class="pts">${t.score ?? 0}</span>
        <button class="del" data-id="${t.id}" title="apagar">✕</button>
      </li>`,
    )
    .join("");

  for (const b of document.querySelectorAll(".del")) {
    b.addEventListener("click", async () => {
      await fetch(`/api/takes/${b.dataset.id}`, { method: "DELETE" });
      await load();
    });
  }
}

$("#render").addEventListener("click", async () => {
  const takeIds = [...document.querySelectorAll(".pick:checked")].map((el) => el.value);
  if (!takeIds.length) return msg($("#renderMsg"), "marca pelo menos uma dublagem", "err");
  $("#render").disabled = true;
  msg($("#renderMsg"), "renderando o vídeo dublado…");

  const r = await (
    await fetch(`/api/videos/${videoId}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ takeIds }),
    })
  ).json();
  if (r.error) {
    $("#render").disabled = false;
    return msg($("#renderMsg"), r.error, "err");
  }

  for (let i = 0; i < 300; i++) {
    await new Promise((res) => setTimeout(res, 2000));
    const st = await (await fetch(`/api/renders/${r.id}`)).json();
    if (st.status === "ready") {
      msg($("#renderMsg"), "pronto! 🎬");
      $("#result").src = st.url;
      $("#result").hidden = false;
      $("#download").href = st.url;
      $("#download").hidden = false;
      $("#render").disabled = false;
      return;
    }
    if (st.status === "error") {
      $("#render").disabled = false;
      return msg($("#renderMsg"), st.error ?? "falhou no ffmpeg", "err");
    }
  }
  $("#render").disabled = false;
  msg($("#renderMsg"), "demorou demais", "err");
});

load();
