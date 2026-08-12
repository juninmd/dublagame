const $ = (s) => document.querySelector(s);
const status = $("#status");

const say = (msg, kind = "info") => {
  status.hidden = false;
  status.textContent = msg;
  status.className = `status ${kind}`;
};

$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#go").disabled = true;
  say("Preparando… baixando vídeo e legenda (pode levar um minuto).");
  try {
    const res = await fetch("/api/videos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: $("#url").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "falhou");
    if (data.status === "ready") return (location.href = `/jogar/${data.id}`);
    poll(data.id);
  } catch (err) {
    say(err.message, "err");
    $("#go").disabled = false;
  }
});

async function poll(id) {
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const v = await (await fetch(`/api/videos/${id}`)).json();
    if (v.status === "ready") return (location.href = `/jogar/${id}`);
    if (v.status === "error") {
      say(v.error ?? "não deu", "err");
      $("#go").disabled = false;
      return;
    }
    say(`Preparando… ${v.title ? `"${v.title}"` : ""} (${i * 2}s)`);
  }
  say("Demorou demais. Tenta um vídeo menor.", "err");
  $("#go").disabled = false;
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

fetch("/api/videos")
  .then((r) => r.json())
  .then((rows) => {
    const ready = rows.filter((r) => r.status === "ready");
    if (!ready.length) return;
    $("#recent").hidden = false;
    $("#list").innerHTML = ready
      .map(
        (r) =>
          `<li><a href="/jogar/${r.id}"><img src="https://i.ytimg.com/vi/${r.id}/mqdefault.jpg" alt="" loading="lazy" /><span>${
            r.title ?? r.id
          }</span><em>${mmss(r.duration ?? 0)}</em></a></li>`,
      )
      .join("");
  })
  .catch(() => {});
