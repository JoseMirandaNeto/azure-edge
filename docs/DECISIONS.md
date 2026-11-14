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

## ADR-007 | 2026-11-11 | CharForge v1 (M2): genoma expandido, builder procedural em engine-adapter, criador com classe primeiro

- **Contexto**: M2 pede base mesh F/M, 20+20 morphs, 6 cabelos, 6 roupas,
  shader anime, criador, LODs e exporte GLB — com orçamento zero (nada de
  assets externos) e sem mexer no protocolo do servidor (sync é M4).
  Decisão de design do Jose: no criador, **escolhe a classe primeiro** e
  depois customiza; a classe define corpo/roupa iniciais.
- **Decisão**: (1) Genoma v1 em `packages/charforge`: 20 morphs corpo +
  20 rosto (-1..1, prior gaussiano truncado), catálogos com 6 cabelos /
  6 roupas / 6 tons de pele / 6 íris, `classId` + `applyClassPreset`
  (corpo/roupa iniciais por classe), `validateGenome` adulto-apenas
  (sem preset jovem/infantil). (2) O builder procedural vive em
  `packages/engine-adapter` (que passa a depender de `three`): ele é a
  camada que isola o three.js, então client e tools usam o mesmo builder
  — o docstring antigo que mandava a implementação p/ `apps/client/src/
  render/` estava defasado e foi corrigido. (3) Personagem = primitivas
  paramétricas fundidas por material (corpo, cabelo, roupa, armas):
  4 draw calls, MeshToonMaterial + rampa cel de 3 tons, LOD0/1/2 por
  segmentos e LOD3 impostor cápsula. (4) Criador no client com 2 passos
  (classe → customização), preview 3D próprio, genoma em localStorage;
  o personagem substitui a cápsula do jogador local (fallback sem
  genoma); remotos seguem cápsulas até o M4. (5) Exporte GLB via
  GLTFExporter (CLI em tools com polyfill mínimo de FileReader p/ Node
  + botão no criador).
- **Alternativas**: base mesh externa licenciada (sem orçamento e sem
  tempo de curadoria de licença p/ M2); rig esquelético de 65 ossos
  (adiado p/ M3+ — o merge estático impede animação de membros, e a
  animação v1 é de corpo inteiro); builder duplicado em client e tools
  (rejeitado — uma única fonte de verdade no engine-adapter).
- **Consequências / riscos**: LOD0 medido em 4 draw calls / 3.200 tris
  (orçamento: ≤6 draws, ≤60k tris); o visual é estilizado-primitivo
  (qualidade de arte depende de revisão do Jose — as proporções são
  paramétricas, não modeladas à mão); classes não-Espadachim mostram a
  arma da classe mas jogam com a mecânica do Espadachim no M2;
  `pnpm install` não consegue reescrever o `pnpm-lock.yaml` neste
  ambiente (EPERM no chown do arquivo temporário) — as entradas de
  importers foram editadas à mão e validadas com o install offline; o
  lockfile já tinha uma divergência pré-existente (root `@types/node`
  fora do lockfile), então `--frozen-lockfile` falha por motivo anterior
  ao M2.
## ADR-008 | 2026-11-13 | Apresentação 2.5D: câmera oblíqua fixa 3D (não sprites 2D)

- **Contexto**: pedido do Jose (2026-11-13): MMORPG hack-and-slash **2.5D em browser**,
  com o visual anime semi-realista de Vindictus/Cabal/Aika. Havia duas leituras
  possíveis: (a) sprites 2D com câmera lateral/top-down; (b) mundo 3D com câmera
  oblíqua fixa — o "2.5D" dos action-RPGs isométricos. A decisão precisava
  reaproveitar M0–M2 (Three.js WebGPU/WebGL2, servidor autoritativo 20 Hz,
  CharForge, base TRELLIS2) em vez de descartá-los.
- **Decisão**: **câmera oblíqua fixa 3D**: personagens e cenário 3D (Three.js,
  como hoje), câmera em ângulo alto (~35°, pitch ≈ −0,6 rad, distância 8–10 m),
  sem rotação livre — rotação opcional em 4 ângulos de 90° (Q/E) como
  concessão, nunca câmera livre de 3ª pessoa. Movimento em plano (WASD),
  mira assistida em cone (COMBAT_SPEC), hitboxes 3D no servidor sem mudança.
  O "2.5D" é apresentação: legibilidade de horda + leitura de telegraphs no
  chão, não uma troca de tecnologia.
- **Alternativas**: sprites 2D (descartada — exigiria spritesheet por
  animação × classe × gênero × armadura, descartaria CharForge e o rig
  Mixamo, e o custo de produção por animação é maior que o 3D já pronto);
  câmera livre de 3ª pessoa (descartada — pior legibilidade com 10–30 mobs,
  mais custo de culling/sombra, e o pedido era 2.5D); top-down puro
  (descartado — esconde o personagem, que é o centro do jogo).
- **Consequências / riscos**: a câmera do M0 (pitch −0,35 rad, distância 7 m,
  3ª pessoa) vira modo de transição; o alvo 2.5D chega em M3 com pitch e
  distância novos em `zones.json`/`camera` (ainda não implementado — o dado
  atual é o do M0). Risco: ângulo fixo esconde o que está atrás de paredes —
  mitigação: paredes baixas/fachadas abertas na cidade e nas dungeons,
  e fade de oclusores acima do jogador. Orçamentos de performance (AGENTS.md
  §6) não mudam.

## ADR-009 | 2026-11-13 | Personagens híbridos: CharForge procedural + base TRELLIS2 como heroína

- **Contexto**: personagens adultos, anime semi-realista, 4 classes com
  armaduras trocáveis e efeitos distintos, orçamento zero. Havia três
  métodos: (a) gerar malha do zero por ruído/IA por personagem; (b) base
  procedural pura (CharForge M2); (c) híbrido.
- **Decisão**: **híbrido**. (1) **CharForge procedural** continua o sistema:
  genoma (morphs corpo/rosto), kit modular de cabelos/roupas/armaduras,
  seed determinística, LODs — é o que anima, customiza e escala para
  milhares de jogadores. (2) A malha **TRELLIS2 `base_s20261221`**
  (47.436 tris após voxel-remesh, 0 furos, 0 non-manifold, 2,8 MB) vira a
  **base feminina heroína** e a referência de proporções do kit — não uma
  malha gerada por jogador. (3) **Kits modulares de armadura por classe**
  (3 conjuntos por classe em `armors.json`) vestem a mesma base sobre o
  esqueleto humanoide único (~65 ossos, alvo Mixamo); cosmético separado
  de stat (transmog, GDD §7).
- **Alternativas**: malha do zero por ruído/IA por personagem (descartada —
  evidência medida: TRELLIS2 nunca define dedos nas mãos; a barra do
  vestido sai esgarçada/rendada; voxel-remesh destrói a topologia para UV
  e rig — Cube Projection contorna a textura, não a topologia; gerar por
  ruído a cada personagem seria pior e não-determinístico); só procedural
  (descartado como único — o visual primitivo do M2 fica abaixo do alvo
  Vindictus; a base TRELLIS2 eleva o patamar sem custo).
- **Consequências / riscos — limites honestos**: mãos sem dedos (esconder
  com manoplas/luvas, como na guerreira); barra do vestido esgarçada
  (aceitar como renda ou cobrir com sobreposição de tecido); rosto no clay
  parece "filme de terror" sem textura (a textura normaliza — não é defeito
  de malha); 256 ossos do Rigify estouram o orçamento (≤70) — o rig da
  base nova precisa ser Mixamo (~65 ossos), ainda pendente. A base
  TRELLIS2 **não está no repo** (vive em `~/workspace/meshes/`) — importar
  para `assets/` com licença/origem documentada é trabalho de M3.

## ADR-010 | 2026-11-13 | Renome das classes, cidade lv 1–20 e 2 instâncias de 8 jogadores

- **Contexto**: pedido do Jose (2026-11-13) com liberdade total: 4 classes
  Guerreiro, Atirador, Curandeiro, Espadachim; 1 cidade inicial com lore
  lv 1–20; 2 instâncias com limite de 8 jogadores. O GDD anterior usava
  Guardião/Clérigo, dungeon de 4 jogadores (M5) e a Vila Lótus como hub.
- **Decisão**: (1) **Renome**: Guardião → **Guerreiro**, Clérigo →
  **Curandeiro** (ids `guerreiro`/`curandeiro`); Espadachim e Atirador
  inalterados. Skills do M1 preservadas com os ids renomeados
  (`guerreiro_provocacao`, `curandeiro_bencao_solar`); cada classe agora
  tem **4 skills** em `skills.json`. (2) **Cidade inicial: Cidade de
  Serket** (id `cidade_serket`, lv 1–20, segura) — sucede a Vila Lótus
  como hub (o nome antigo vira lore: a vila cresceu ao redor do oásis e
  virou cidade; a Praça do Oásis mantém o motivo do lótus). Lore, 5
  distritos, 8 NPCs e 12 quests encadeadas em `city.json` +
  `docs/CIDADE_LV1_20.md`. (3) **2 instâncias de 8 jogadores**:
  Tumbas Soterradas (lv 5–12, lockout 8 h) e Templo de Serket (lv 13–20,
  lockout 24 h), em `dungeons.json` + `docs/INSTANCIAS.md`; o loop de
  dungeon passa de 4 para **8 jogadores** (party de campo continua 4).
  (4) Modelo de dados: `zones.json` (espacial), `city.json` (lore/quests),
  `armors.json` (3 conjuntos por classe), `dungeons.json` (encontros +
  loot + lockout) — validados em `packages/gamedata`.
- **Alternativas**: manter Guardião/Clérigo (descartada — o pedido renomeia
  explicitamente); manter dungeon de 4 (descartada — o pedido fixa 8, e
  8 encaixa no boss Serket com mecânicas de grupo); criar a cidade como
  zona nova separada da Vila Lótus (descartada — duplicaria o hub).
- **Consequências / riscos**: testes e docs antigos que citavam
  Guardião/Clérigo/4 jogadores foram atualizados (GDD §4–§5, ROADMAP M3/M5,
  `gamedata`); saves/personagens antigos com `classId` guardião/clerigo
  precisam de migração em M4 (mapeamento 1:1, sem perda de progresso).
  O boss Serket ganhou mob próprio (`serket`, 9.000 HP) e Neferet
  (`neferet`, 4.500 HP) em `mobs.json` — números de boss para 8 jogadores,
  a balancear em playtest (M3).

