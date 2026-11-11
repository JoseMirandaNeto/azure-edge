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
