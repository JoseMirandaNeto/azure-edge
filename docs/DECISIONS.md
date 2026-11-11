# ADRs — Azure Edge

Formato: `ADR-00N | data | contexto | decisão | alternativas | consequências`.

## ADR-001 | 2026-11-11 | Backend de conta/auth/persistência p/ M0–M2

- **Contexto**: M0 precisa de conta/auth/persistência sem custo, para teste com 40 pessoas.
- **Decisão**: **Supabase Free** como protótipo em M0–M2, atrás da interface
  `Persistence` em `apps/server-api` (nada de credenciais no repo; só `.env.example`).
  Tráfego de jogo (tick/snapshots) **nunca** passa pelo Supabase — só conta, auth
  e persistência de personagem.
- **Limites verificados do plano Free**: 50.000 MAU, 500 MB de banco, 5 GB egress/mês,
  200 conexões Realtime simultâneas — folga ampla para 40 testers.
- **Alternativas**: Postgres + Redis próprios desde M0 (mais trabalho/ops, sem ganho
  em M0); Firebase (lock-in maior, limites piores p/ Realtime).
- **Consequências / riscos**: projeto Free **pausa após 7 dias sem atividade** —
  mitigação: keep-alive semanal (ping agendado ao projeto) + abstração de
  persistência pronta para trocar por Postgres próprio (M4) sem tocar o jogo.
  Implementação do client Supabase fica para M4, quando houver contas de verdade.

## ADR-002 | 2026-11-11 | Stack e instalação do pnpm

- **Contexto**: ambiente com Node v24.22.1, npm 10.9.4, sem pnpm/corepack.
- **Decisão**: pnpm **9.15.9** instalado via `npm i -g pnpm@9` (zero custo);
  `packageManager: pnpm@9.15.9` fixado no root. Stack fixada: TypeScript 5.9,
  Vite 7, Three.js 0.182.0, ws 8, Vitest 3, Turborepo 2.
- **Alternativas**: npm workspaces (sem o isolamento de `node_modules` do pnpm);
  corepack (não encontrado no ambiente).
- **Consequências**: `pnpm install` reprodutível via `pnpm-lock.yaml` commitado.

## ADR-003 | 2026-11-11 | Payload JSON dentro do framing binário (M0)

- **Contexto**: `docs/PROTOCOL.md` define frame `[u8 tipo][u16 len][payload]` e
  serialização binária; M0 precisa de algo debugável e testável rápido.
- **Decisão**: manter o **framing binário** e usar **JSON UTF-8 como payload em M0**,
  com `encodeMessage`/`decodeMessages` em `packages/shared` (Uint8Array, funciona
  em Node e no browser — `Buffer` não existe no browser).
- **Alternativas**: FlatBuffers/bitECS desde M0 (mais trabalho, sem ganho mensurável
  com 40 jogadores e snapshots de poucos KB/s).
- **Consequências**: payload maior que binário quantizado, mas dentro do orçamento
  (≤ 20 KB/s down). Quantização (pos 1/64 m, delta contra último ack) é trabalho de
  M1+ e não muda a interface de framing.

## ADR-004 | 2026-11-11 | Renderer WebGPU com fallback WebGL2 + placeholder

- **Contexto**: AGENTS.md exige WebGPURenderer com fallback WebGL2; não há assets
  licenciados em M0.
- **Decisão**: client tenta `WebGPURenderer` (Three.js 0.182, `three/webgpu`,
  `await init()` verificado nos typings instalados) e cai para `WebGLRenderer`
  se `navigator.gpu` não existir ou `init()` falhar. Personagem = placeholder
  procedural (cápsula + cabeça + marcador de direção), sem nenhum asset externo.
- **Alternativas**: só WebGL2 (perderia o alvo WebGPU); GLB placeholder baixado
  (risco de licença, download extra).
- **Consequências**: bundle inicial ~1,35 MB (dentro do orçamento de 25 MB);
  arte real e CharForge completo chegam em M2.
