# Changelog

## [0.1.0] — 2026-11-11 — Milestone M0 Fundação

- Monorepo pnpm workspaces + Turborepo, TypeScript estrito (`strict: true`).
- `packages/shared`: protocolo framed `[u8][u16][payload]`, PRNG `sfc32` com seed,
  simulação pura de movimento (determinística, diagonal normalizada).
- `packages/gamedata`: zona Vila Lótus data-driven e validada (`walkSpeedMps 6`).
- `packages/charforge`: genoma determinístico por seed (stub v0, adultos apenas).
- `packages/engine-adapter`: interfaces do renderer + probes WebGPU/WebGL2.
- `apps/server-game`: zona autoritativa, tick 20 Hz, validação de velocidade/seq,
  snapshots 20 Hz, métricas de tick em log.
- `apps/client`: Vite + Three.js 0.182 (WebGPU c/ fallback WebGL2), terreno procedural,
  placeholder cápsula, câmera 3ª pessoa, prediction 60 Hz + reconciliation,
  painel debug F3, simulação de latência via `?latency=100`.
- `apps/server-api`: abstração `Persistence` (in-memory p/ dev; Supabase em M4).
- `apps/tools`: CLI `validate` / `genome <seed>`.
- Verificado: `pnpm build` 8/8 verde; `pnpm test` 19/19 verde; smoke 2 clients PASS
  (45 snapshots/cliente, +8,7 m em 1,5 s, ackSeq + Pong OK).
- Pendente de validação visual: FPS no navegador (sem browser headless utilizável
  neste ambiente; ver README.md).

## [0.2.0] — 2026-11-11 — M1 netcode/qualidade (parcial, sem combate)

- `packages/shared`: novos helpers puros `reconcilePrediction` (rewind +
  re-apply dos inputs não confirmados; teleport só se erro > 2 m),
  `decayCorrection` (glide com tau ~120 ms) e `interpolateRemote` (buffer de
  100 ms, AGENTS.md §4), com 9 testes novos (28 testes no repo).
- `apps/client`: reconciliação suave (o erro vira offset de correção que
  decai em vez de teleporte), câmera com lerp (tau 90 ms), remoto interpolado
  a partir do buffer de snapshots; painel F3 mostra `corr` (erro de
  reconciliação atual).
- F3: `draw calls` agora lê `info.render.drawCalls` (por frame). O número
  1742–4374 era `info.render.calls` do WebGPURenderer, que é CUMULATIVO desde
  o início do app (conta render()s = frames), não draws por frame. Draws reais
  da cena: no máximo ~65 meshes (terreno 1 + ~56 props + 2 jogadores × 4),
  dentro do orçamento de ≤600 — confirmar o número exato no Brave do Jose.
- Medido com harness headless (`/tmp/latency-harness.mjs`, servidor real,
  2 clients, 8 s, movimento com curvas): com latência simulada de 100 ms, o
  código M0 dava 53 teleportes e 149 frames com salto > 0,3 m; o novo dá
  0 teleportes e 0 frames com salto > 0,3 m (salto máx. 0,109 m/frame = passo
  normal a 6 m/s). Com 500 ms: M0 53 teleportes / 143 frames; novo 0 / 0.
- NÃO medido no navegador real: o quicar com `?latency=100` ainda precisa da
  confirmação visual do Jose no Brave (sem browser headless utilizável aqui).

## Dívida técnica p/ M1 (registrado 2026-11-11, validado pelo Jose no túnel)

- Reconciliação com latência alta quica: com `?latency=100` (RTT ~550 ms via túnel)
  as cápsulas quicam e a tela treme — a correção teleporta quando o erro passa de
  0,5 m, a câmera segue a prevista sem suavização e o remoto persegue o snapshot
  sem buffer. Correção p/ M1: deslizar a reconciliação (~100–150 ms, teleportar só
  se erro >2 m), amortecer a câmera, interpolar o remoto com buffer de ~100 ms.
  → **Feito em 0.2.0** (ver acima); falta a confirmação visual no Brave.
- Draw calls acima do orçamento: 1742–4374 por frame (orçamento ≤600/cena) com só
  ~9700 tris — investigar o que o WebGPU está contando / instancing e merge de meshes.
  → **Causa encontrada em 0.2.0**: era erro de medição do painel (contador
  cumulativo, ver ADR-005); draws reais ~65/frame, dentro do orçamento.
