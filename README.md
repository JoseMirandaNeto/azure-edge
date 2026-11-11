# Azure Edge — MMORPG Action Hack & Slash 3D (browser-first)

Monorepo do Milestone **M0 — Fundação** (ver `docs/ROADMAP.md`).
Visão completa em `docs/GDD.md`; regras inegociáveis em `AGENTS.md`;
prompt mestre do agente em `00_AGENT_PROMPT.md`.

## Plano M0 (executado)

1. Monorepo pnpm workspaces + Turborepo, TypeScript estrito, sem `any` sem justificativa.
2. `packages/shared`: protocolo binário-framed, PRNG com seed, simulação pura de movimento.
3. `packages/gamedata`: tuning data-driven validado (`zone_lotus_village.json`).
4. `packages/charforge`: stub v0 determinístico por seed (pipeline completo é M2).
5. `packages/engine-adapter`: interfaces do renderer (Three.js isolado p/ port futuro).
6. `apps/server-game`: zona autoritativa Node/TS, tick fixo 20 Hz, só aceita INPUTS.
7. `apps/client`: Vite + Three.js WebGPU (fallback WebGL2), terreno, placeholder cápsula, câmera 3ª pessoa, prediction + reconciliation, painel F3.
8. `apps/server-api`: abstração de persistência (Supabase M0–M2, sem credenciais no repo).
9. Testes: unitários (Vitest) + smoke de 2 clients contra o servidor real.
10. Docs: ADRs em `docs/DECISIONS.md`, changelog em `docs/CHANGELOG.md`.

## Pré-requisitos

- Node.js 20+ (testado com Node v24.22.1) e pnpm 9 (`npm i -g pnpm@9`).
- Zero custo: nenhuma conta, deploy ou serviço pago é necessário para rodar local.

## Como rodar (local)

```bash
pnpm install
pnpm build        # compila todos os pacotes
pnpm test         # 19 testes unitários (shared, gamedata, charforge, server-game)

# Terminal 1 — servidor de jogo (porta 3001, tick 20 Hz)
pnpm --filter @azure-edge/server-game start

# Terminal 2 — client (http://127.0.0.1:5173)
pnpm --filter @azure-edge/client dev
```

## Testar com 2 clients (2 abas)

1. Abra `http://127.0.0.1:5173/` em **duas abas** do navegador.
2. Em cada aba você é um jogador (cápsula azul = você, laranja = o outro).
3. **WASD** move, **arrastar o mouse** gira a câmera, **F3** abre o painel de debug
   (FPS, ms de frame, draw calls, tris, ping, snapshots perdidos, posição).
4. Para simular latência: `http://127.0.0.1:5173/?latency=100` (ping medido ≈ 100 ms).
5. Smoke test automatizado (servidor real + 2 clients WS, sem navegador):
   `pnpm --filter @azure-edge/server-game smoke`

## Arquitetura (M0)

```
Browser (Vite + Three.js WebGPU/WebGL2)
  --WebSocket binário [u8 tipo][u16 len][payload JSON]--> server-game (Node/TS, tick 20 Hz, ECS mínimo)
  --conta/auth/persistência (M0: stub em memória; M0–M2: Supabase Free)--> server-api
```

- O client **só envia inputs** (direção, yaw, botões) com sequence number.
- O servidor simula, valida velocidade (anti-teleporte) e devolve **snapshots**.
- O client faz **prediction** (60 Hz local) + **reconciliation** ao receber o snapshot.
- Tráfego de jogo **não** passa pelo Supabase — só conta/auth/persistência.

## Métricas medidas (M0, nesta máquina)

| Métrica | Valor medido | Orçamento |
|---|---|---|
| `pnpm build` | 8/8 pacotes, verde | — |
| `pnpm test` | 19/19 testes, verde | verde |
| Smoke 2 clients | PASS: 45 snapshots/cliente em ~2 s, ambos veem 2 entidades, A andou +8,7 m em 1,5 s (6 m/s), ackSeq avançou, Pong OK | 2+ clients se vendo |
| Tick servidor, 200 entidades | max < 10 ms (teste unitário) | p99 ≤ 10 ms |
| Download inicial (build) | ~1,35 MB JS total (726 KB app + 622 KB three.webgpu, gzip ~366 KB) | ≤ 25 MB |
| FPS no navegador | **não medido aqui** — sem navegador headless utilizável neste ambiente (ver Riscos) | 60 fps |

## Limitações conhecidas (M0)

- Sem combate, mobs, skills ou persistência real — M1/M2/M4.
- Payload do protocolo é JSON dentro do framing binário (binário quantizado é M1+, ADR-003).
- Sem ESLint configurado (typecheck estrito + testes cobrem M0; lint é dívida p/ M1).
- O renderer WebGPU não foi exercitado em navegador headless aqui: o Chromium
  disponível (`/opt/meta-chromium`) exige uma política WebGL assinada do launcher
  Hatch e o download do Chromium do Playwright falhou — **abra o client no
  navegador normal e confira FPS/F3** antes de considerar o M0 100% validado
  visualmente.
