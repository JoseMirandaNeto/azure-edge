# Changelog

## [0.4.1] — 2026-11-11 — Integração da arte aprovada (ícones + tela de carregamento)

- **Tela de carregamento** (`apps/client`): arte da Serket v1d
  (`concept_loading_serket_f_v1d`, 1024x576, 63 KB) como splash em tela
  cheia enquanto o client carrega/conecta, com "Carregando…" e barra
  animada por cima; fade-out ao conectar (ou ao abrir o criador / ao
  desconectar, para a mensagem de erro não ficar escondida). Se a imagem
  falhar, o fundo escuro + texto continuam — o jogo nunca trava por isso.
- **Ícones no HUD**: slot da skill no HUD com o ícone do Corte Crescente
  v2 (`[Q]`, M2: só o Espadachim é jogável). Cards de classe do criador
  passam a mostrar o ícone da skill de cada classe (mix final aprovado:
  Corte Crescente v2, Provocação v1, Bênção Solar v3a, Disparo Rápido v3a).
- **Atlas final** (`assets/generated/comfyui/icons/atlas_final.png`):
  2x2 de 256 px na ordem Corte Crescente, Provocação, Disparo Rápido,
  Bênção Solar.
- **Assets de runtime** copiados para `apps/client/public/assets/` (ícones
  256 px, atlas, `loading_serket.jpg`); originais gerados intactos em
  `assets/generated/comfyui/`.
- **Pendente — KTX2**: `basisu`/`toktx` não existem nesta VM, então os
  assets vão em PNG/JPEG por enquanto (o HUD é `<img>` HTML, não precisa
  de KTX2). Conversão para KTX2 fica para quando houver transcoder.

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

## [0.4.0] — 2026-11-11 — Milestone M2 CharForge v1

- **Genoma v1** (`packages/charforge`): 20 morphs de corpo + 20 de rosto
  (-1..1, prior gaussiano truncado), 6 cabelos, 6 roupas, 6 tons de pele,
  6 cores de íris/cabelo, paletas por tema (azul-jade/vermelho-carmim/
  dourado, GDD §10), `classId` (padrão Espadachim), `validateGenome`
  (adultos apenas — sem preset jovem/infantil). `applyClassPreset`:
  escolher a classe define corpo/roupa iniciais (decisão de design do
  Jose: **classe primeiro, depois customização**).
- **Builder procedural** (`packages/engine-adapter/src/character.ts`):
  humanoide paramétrico F/M a partir de primitivas (lathe p/ torso,
  esferas/cilindros p/ membros e rosto), morphs como escala/deslocamento
  por parte, peças fundidas por material → **4 draw calls/personagem**,
  shader anime via `MeshToonMaterial` + rampa cel de 3 tons, armas por
  classe (duas espadas, espada+escudo, espingarda, cajado). LODs por
  distância: LOD0/1/2 por segmentos, LOD3 impostor cápsula.
- **Criador de personagem** (`apps/client/src/creator.ts` + overlay em
  `index.html`): passo 1 — 4 cards de classe (só Espadachim jogável no
  M2, demais marcadas "M3 · em breve"); passo 2 — nome (define a seed),
  gênero, 8 sliders de corpo + 8 de rosto, 6 cabelos, 6 roupas, pele,
  olhos, Sortear, preview 3D com órbita por arrastar e **Exportar GLB**.
  Abre antes de entrar na zona (sem genoma salvo ou `?creator=1`);
  botão "Personagem" no HUD reabre sobre o jogo. Genoma salvo em
  `localStorage` (`azure-edge:genome:v1`); sincronização multiplayer é M4.
- **No jogo**: o personagem criado substitui a cápsula do jogador local
  (fallback p/ cápsula sem genoma); jogadores remotos continuam cápsulas
  até o M4. Animação v1 é de corpo inteiro (bob + lean) — sem rig
  esquelético (dívida p/ M3+).
- **Exporte GLB** (`apps/tools export <seed> <file.glb> [lod]`): GLTFExporter
  no Node com polyfill mínimo de FileReader; mesmo builder do client.
  `validate` agora checa 1000 seeds e imprime métricas LOD.
- Medido: **1000 seeds sem erro** (teste); LOD0 **4 draw calls, 3.200 tris,
  1,62 m**; LOD1 1.605 tris; LOD2 940 tris; LOD3 1 draw call, 70 tris;
  200 seeds constroem o mesh sem erro; GLB LOD0 com 156.668 bytes.
  Verificado: `pnpm test` 68/68 verde, `pnpm build` 8/8, `pnpm typecheck`
  8/8. Flake conhecido (pré-existente, M1): o teste de p99 do tick do
  servidor falha às vezes sob contenção de CPU na VM compartilhada —
  re-rodado sozinho passa 21/21. FPS no criador e no jogo com o
  personagem ainda dependem do playtest no Brave do Jose (sem browser
  headless utilizável aqui).
- Limitação conhecida: classes não-Espadachim mostram a arma da classe no
  visual, mas a mecânica de combate continua a do Espadachim no M2.

## [0.3.1] — 2026-11-11 — Iteração M1: captura do mouse + órbita da câmera

- **Mouse-look (feedback do playtest do Jose)**: clicar no jogo captura o
  mouse (pointer lock); mover o mouse orbita a câmera — horizontal gira o
  yaw, vertical sobe/desce a câmera (pitch 0,05–1,25 rad, padrão preserva o
  enquadramento do M0). ESC libera o mouse; clicar de novo recaptura. O
  clique que captura não dispara ataque. Sem pointer lock (ou com ele
  recusado), arrastar o mouse continua girando a câmera como antes.

## [0.3.0] — 2026-11-11 — Milestone M1 Combate Core

- **Classes (decisão do Jose, substitui Lâmina/Arqueira/Mística)**: Guardião
  (escudo e arma), Atirador (espingarda), Clérigo (cura sagrada), Espadachim
  (duas espadas). Classe jogável do M1: **Espadachim**.
- **Skills finais, 1 por classe, pt-BR, data-driven** (`packages/gamedata`):
  Espadachim — **Corte Crescente** (arco 140°, raio 3,2, mult 2,2, poise 20,
  knockback, superArmor f8–f18, cd 6 s, mana 18; jogável no M1); Guardião —
  **Provocação** (taunt em 10 m por 5 s + 30 HP temporário, cd 10 s, mana 20);
  Atirador — **Disparo Rápido** (2 tiros em cone, cd 5 s, mana 15); Clérigo —
  **Bênção Solar** (buff: −30% dano por 8 s, raio 6 m, cd 8 s, mana 25). As 3
  últimas são dados validados (não jogáveis; Guardião/Atirador/Clérigo chegam
  no M3). A mecânica de taunt existe no servidor (`tauntMobs` + IA reage).
- **Mobs do M1 (decisão do Jose — o lobo SAI do M1 e fica para depois)**:
  insetoides — **escorpião** (principal, HP 60), formiga gigante (rápida,
  HP 40), besouro (blindado, DEF 6, HP 90) — e **múmia** (lenta e resistente,
  HP 120, ATQ 12). Mesma IA simples por dados: patrulha, aggro por
  proximidade, ataque telegrafado (windup + anel vermelho no chão), leash,
  respawn. Arena: 3 escorpiões + 1 formiga + 1 besouro + 1 múmia.
- **Combate autoritativo** (`apps/server-game`, frames lógicos 60 fps, 3
  sub-steps por tick de 20 Hz): cadeia básica de 4 golpes do Espadachim
  (tabela da COMBAT_SPEC: startup 7/6/9/14, mult 0,9/1,0/1,3/2,0, cancel,
  finisher com knockdown), esquiva (i-frames f3–f14, perfeita f3–f8: +15 mana
  e slow-mo local de 120 ms, custo 20 stamina, cancela recovery de ataque
  por +5), guarda (70% dano frontal, parry nos primeiros 8 frames → stagger
  no atacante), skill com cooldown/mana, hitboxes em arco no servidor,
  poise/stagger (imunidade 4 s), números de dano, fórmula de dano da spec
  (crit 5%, variância 0,95–1,05 via PRNG com seed, bônus de estado,
  decaimento de combo após 5 acertos). Inputs inválidos viram Reject e o
  client cancela o visual com blend de 80 ms.
- **Client**: controles LMB ataque, Espaço esquiva, RMB guarda, Q skill;
  prediction do combate (lunge, dash de esquiva, guarda parada), arco de
  golpe translúcido, números de dano flutuantes (crítico/finisher/parry),
  hit-stop (4 f normal / 7 f crítico-finisher), shake de câmera ≤ 0,15 e
  pulso de FOV, barras de HP/stamina/mana, barras de HP dos mobs, painel F3
  com estado de combate e alvo mais próximo.
- **Arena**: Dunas de Serket / Oásis dos Nômades — terreno de dunas procedural,
  paleta de areia (dados da zona), props de deserto (pedras, cactos, palmeiras
  secas, ruínas). Vila Lótus continua nos dados como hub futuro.
- **Protocolo (aditivo, sem bump de versão)**: `EntityState` ganha
  `kind`/`name`/`mobId`/`staminaPct`/`manaPct` e `animState` 9 = windup
  (telegraph); nova mensagem `Event` (13) para hit/kill/parry/perfect/skill/heal.
- **Medido**: `pnpm test` 53/53 verde; `pnpm build` 8/8; `pnpm typecheck` 12/12;
  tick com 30 mobs + combate: **avg 0,33 ms, p99 0,88 ms** (orçamento p99
  ≤ 10 ms; max 52 ms é um spike isolado de warm-up); smoke 2 clients PASS
  (2 jogadores + 6 mobs no snapshot).
- **Pendente de validação visual (Jose)**: sensação do combate no Brave
  (peso dos golpes, hit-stop, números de dano), FPS com 6 mobs em cena,
  e o quicar com `?latency=100` após a correção do netcode (0.2.0).

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
- Confirmado visualmente pelo Jose no Brave em 2026-11-11 (`?latency=100`, ping
  451 ms): o jogador anda normal, sem quicar; `corr: 0.03`, draw calls 26,
  51 fps, 0 lost/rejects, players 2, tick 51014. O "pulinho leve" ao andar é o
  walk bob intencional de ±0,05 m do renderer (para o movimento ler na tela),
  não lag.

## Dívida técnica p/ M1 (registrado 2026-11-11, validado pelo Jose no túnel)

- Reconciliação com latência alta quica: com `?latency=100` (RTT ~550 ms via túnel)
  as cápsulas quicam e a tela treme — a correção teleporta quando o erro passa de
  0,5 m, a câmera segue a prevista sem suavização e o remoto persegue o snapshot
  sem buffer. Correção p/ M1: deslizar a reconciliação (~100–150 ms, teleportar só
  se erro >2 m), amortecer a câmera, interpolar o remoto com buffer de ~100 ms.
  → **Feito em 0.2.0** (ver acima); confirmado visualmente pelo Jose no Brave
  em 2026-11-11: anda normal com `?latency=100` (ping 451 ms, corr 0,03).
- Draw calls acima do orçamento: 1742–4374 por frame (orçamento ≤600/cena) com só
  ~9700 tris — investigar o que o WebGPU está contando / instancing e merge de meshes.
  → **Causa encontrada em 0.2.0**: era erro de medição do painel (contador
  cumulativo, ver ADR-005); draws reais ~65/frame, dentro do orçamento.
