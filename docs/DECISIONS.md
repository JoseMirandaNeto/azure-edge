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

## ADR-005 | 2026-11-11 | Reconciliação suave, câmera suave, buffer de interpolação e contador de draw calls

- **Contexto**: com `?latency=100` (RTT ~550 ms via túnel) as cápsulas quicam e
  a tela treme; o painel F3 mostrava 1742–4374 "draw calls" com só ~9700 tris.
- **Decisão**: (1) reconciliação mantém rewind + re-apply dos inputs não
  confirmados, mas o erro vira offset de correção que decai com tau ~120 ms;
  teleport só se erro > 2 m. (2) câmera com lerp (tau 90 ms) em foco e posição.
  (3) remoto renderizado ~100 ms no passado, interpolado entre os 2 snapshots
  que cercam o instante (AGENTS.md §4), sem mudar o protocolo. (4) painel F3
  lê `info.render.drawCalls` (por frame), com fallback para `calls` no WebGL2.
- **Alternativas**: manter o teleporte > 0,5 m (quicar visível); buffer remoto
  de 200 ms (mais lag visual); reescrever o renderer p/ instancing (sem
  evidência de que os draws eram o problema — e não eram).
- **Consequências / riscos**: o erro visual transitório fica visível por
  ~120 ms em vez de sumir no teleporte (troca de exatidão instantânea por
  suavidade); a 500 ms de RTT o erro residual pode chegar a ~3 m (RTT ×
  velocidade) sem saltos — deploy real com ping menor reduz isso. Draws reais
  ~65/frame no máximo (contagem de meshes), a confirmar no Brave. Medição
  headless em `/tmp/latency-harness.mjs` (não commitado, servidor real, 2
  clients): 100 ms → 0 saltos > 0,3 m (M0: 149); 500 ms → 0 (M0: 143).
  Confirmação visual no Brave com `?latency=100` ainda pendente.

## ADR-006 | 2026-11-11 | Combate core do M1: classes, skills finais, mobs e protocolo aditivo

- **Contexto**: M1 precisa de combate jogável com as decisões de design do Jose
  (4 classes novas, 1 skill por classe, mobs do deserto) sem quebrar o M0.
- **Decisão**: (1) Classes de lançamento: Guardião, Atirador, Clérigo,
  Espadachim (substituem Lâmina/Arqueira/Mística); só o Espadachim é jogável
  no M1. (2) Skills finais em pt-BR, data-driven: Corte Crescente (Espadachim,
  jogável), Provocação (Guardião, taunt), Disparo Rápido (Atirador),
  Bênção Solar (Clérigo, buff) — as 3 últimas são dados validados, e a
  mecânica de taunt existe no servidor (`tauntMobs`: a IA do mob redireciona
  o alvo para o provocador). (3) Mobs do M1: insetoides (escorpião principal,
  formiga, besouro) + múmia; o **lobo sai do M1** e fica para depois — a troca
  é só de dados (`mobs.json`), a IA é a mesma. (4) Combate em frames lógicos
  60 fps com 3 sub-steps por tick de 20 Hz no servidor; hitboxes em arco
  avaliadas por sub-step. (5) Protocolo **aditivo, sem bump de versão**:
  `EntityState` ganha `kind`/`name`/`mobId`/`staminaPct`/`manaPct` e
  `animState` 9 = windup (telegraph); mensagem `Event` (13) já prevista no
  PROTOCOL.md para hit/kill/parry/perfect/skill/heal. (6) Arena de teste:
  Oásis dos Nômades (Dunas de Serket), procedural; a zona completa com boss
  Serket não é escopo do M1.
- **Alternativas**: lobo como mob de teste (descartado por decisão do Jose);
  bump de `PROTOCOL_VERSION` (desnecessário — campos novos são opcionais e
  clients antigos os ignoram); hitboxes avaliadas só por tick (perderia
  janelas ativas de 4 frames).
- **Consequências / riscos**: tick com 30 mobs + combate medido em
  avg 0,33 ms / p99 0,88 ms (orçamento p99 ≤ 10 ms); o cast de Provocação e
  Bênção Solar só existe como dados + mecânica de mob até o Guardião/Clérigo
  chegarem (M3); a sensação do combate (peso, hit-stop) ainda precisa do
  playtest do Jose no Brave — sem browser headless utilizável aqui.
