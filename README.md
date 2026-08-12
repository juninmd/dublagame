# 🎙️ Dublagame

Jogo de dublagem em cima de vídeo do YouTube. Você cola o link, o app baixa vídeo
e legenda com tempo, separa as falas por personagem e te faz ler em **karaokê**
enquanto grava sua voz. No fim ele renderiza o **mp4 com a sua dublagem** por cima
do áudio original abafado.

Tem mais de um personagem no vídeo? Cada pessoa faz uma passada dublando o seu, e
o render junta todas as vozes no mesmo vídeo. Cada fala vale pontos (encaixe no
tempo + preencher a fala), com combo e placar da sala.

No ar: <https://dublagame.antonio-code.duckdns.org>

## Como funciona

| Etapa | O quê |
| --- | --- |
| Ingest | `yt-dlp` baixa o vídeo (≤720p) e a melhor legenda disponível (pt > en, json3 > vtt) |
| Falas | `json3` traz tempo **por palavra** — é o que acende o karaokê. Sem isso, distribuímos as palavras no intervalo da legenda |
| Elenco | prefixo `NOME:` na legenda → personagens direto. Senão, rotulagem opcional por IA. Sempre dá pra ajustar na mão na UI |
| Partida | `MediaRecorder` grava a voz, `AnalyserNode` amostra o volume a cada 40 ms e pontua cada fala (encaixe 65% + tempo de entrada 35%) |
| Render | `ffmpeg` abaixa o original para 14% nas janelas dubladas e mixa as faixas dos jogadores no tempo certo |

## Rodar local

```bash
bun install
cp .env.example .env
bun run dev            # http://localhost:3000
```

Precisa de `yt-dlp` e `ffmpeg` no PATH. O microfone só é liberado pelo navegador em
`localhost` ou HTTPS.

### Teste E2E

Roda uma partida inteira headless com o microfone falso do Chromium (ingest →
karaokê → gravação → nota → upload → render):

```bash
bunx playwright install chromium
node test/smoke.mjs http://localhost:3000
```

Precisa ser `node` — Playwright não fala o protocolo de pipe do Bun.

## Configuração

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `PORT` | `3000` | porta HTTP |
| `DATA_DIR` | `./data` | sqlite, vídeos, takes e renders |
| `MAX_DURATION_SEC` | `900` | recusa vídeo mais longo que isso |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` | vazio | liga a separação automática de personagens via gateway LiteLLM |
| `YTDLP_COOKIES` | vazio | arquivo de cookies do YouTube, se o IP cair no bot check |

Em produção a chave de IA está **desligada** (não existe `dublagame_litellm_key`
no `sops-master-secret`): o app cai na heurística e no editor de elenco da própria
tela, que resolve o caso multi-personagem sem IA.

## Deploy

Imagem `ghcr.io/juninmd/dublagame:latest`, chart em `app-charts/dublagame`
(Deployment + Service + Ingress + PVC 5Gi), Application no root-app do ArgoCD.
Como o CI do GitHub Actions segue bloqueado por billing, a imagem vai a mão:

```powershell
gh auth token | docker login ghcr.io -u juninmd --password-stdin
docker build --platform linux/amd64 -t ghcr.io/juninmd/dublagame:latest .
docker push ghcr.io/juninmd/dublagame:latest
ssh ubuntu@201.54.21.165 "sudo -n k3s kubectl -n dublagame rollout restart deploy/dublagame"
```

## Limites conhecidos

- Vídeo **precisa** ter legenda (automática serve). Sem legenda não há karaokê.
- Legenda automática não marca quem fala; a separação por personagem é palpite
  (IA ou heurística) — o editor da UI existe justamente para corrigir.
- Download roda no servidor: se o IP do cluster cair no bot check do YouTube,
  use `YTDLP_COOKIES`.
- Vídeo e dublagens ficam no PVC, sem login. É app de brincadeira em rede
  pessoal — não coloque nada sensível.
