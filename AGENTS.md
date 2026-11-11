# AGENTS.md — Regras do Projeto "Azure Edge"

## 1. Stack (fixa; mudar só via ADR)
- Linguagem: **TypeScript estrito** (client, server, shared). `strict: true`, sem `any` sem comentário justificando.
- Monorepo: **pnpm workspaces** + Turborepo. Node LTS.
- Render: **Three.js com WebGPURenderer** (fallback automático WebGL2) + **TSL** para shaders. Camada `engine-adapter` isola o Three.js para facilitar port futuro (Unity/Unreal/nativo).
- Física/colisão: **Rapier (WASM)** client e server (mesma versão, determinismo desejável; servidor é a verdade).
- Rede: **WebSocket (binário)** no M0-M3; **WebTransport** (datagramas) como upgrade com fallback WS. Serialização binária: **FlatBuffers ou bitECS+schema próprio**; JSON só em ferramentas/debug.
- Servidor de jogo: **Node.js/TS**, ECS (bitECS), tick fixo 20 Hz (mundo) / 30 Hz (instâncias de dungeon). Zonas = processos separados. Escalar horizontalmente depois (Redis pub/sub p/ chat/party).
- Backend de conta/persistência: **PostgreSQL** + Redis. Auth: JWT curto + refresh. (Supabase aceitável para M0-M2 como protótipo.)
- UI: **HTML/CSS + Preact/Solid** sobre o canvas (HUD). Nada de UI dentro do WebGL, exceto nameplates/dano.
- Assets: **glTF 2.0 + Meshopt + KTX2 (Basis)**. Animações em glTF com retarget para esqueleto humanoide único.
- Testes: Vitest (unit), Playwright (smoke/E2E com browser), bots headless para carga.

## 2. Estrutura de pastas
```
/apps/client        # Browser client (Vite)
/apps/server-game   # Zonas/instâncias
/apps/server-api    # Auth, personagens, inventário, loja
/apps/tools         # CLI: bake de personagens, validação de dados, bots
/packages/shared    # Tipos, schemas de rede, constantes, fórmulas de combate
/packages/engine-adapter
/packages/gamedata  # JSON/YAML: skills, mobs, itens, drops (data-driven)
/packages/charforge # Gerador procedural de personagens
/docs
```
## 3. Princípios de código
- **Data-driven**: skills, mobs, itens, dungeons ficam em `gamedata` validados por schema (Zod). Zero números mágicos no código de gameplay.
- `shared` não importa de `client` nem `server`. Fórmulas de combate vivem em `shared` e são puras/testáveis.
- Funções puras e determinísticas na simulação; RNG sempre com seed injetada (PRNG `sfc32`/`mulberry32`); proibido `Math.random()` em gameplay.
- Sem alocação no hot path (loop de render, tick). Reuse vetores/arrays (object pools).
- Nomes em inglês no código; textos de jogo via i18n (pt-BR, en, ko, ja desde o início).
- Commits convencionais (`feat:`, `fix:`, `perf:`...). PRs pequenos. Todo PR passa: `lint`, `typecheck`, `test`, `build`.

## 4. Netcode (resumo; detalhes em PROTOCOL.md)
- Client envia **inputs** com sequence number (move dir, ações, skill id, alvo). 
- Servidor simula, valida cooldown/custo/alcance/LoS, aplica dano, devolve **snapshots** delta-comprimidos + eventos.
- Client: **prediction + reconciliation** do jogador local; **interpolação** (100 ms buffer) para entidades remotas; **lag compensation** limitada (máx. 150 ms rewind) para hit de jogador.
- **Interest management**: grid espacial; cada client recebe só entidades no raio (padrão 60 m). Prioridade por distância.
- Anti-cheat básico: validação de velocidade, rate limit de inputs, checagem de cooldown, nunca confiar em dano/loot do client.

## 5. Combate (resumo; detalhes em COMBAT_SPEC.md)
- Ação em tempo real, sem tab-target. Hitboxes (cápsulas/arcos/cones) ativas em janelas de frames definidas no gamedata.
- Estados: Idle, Move, Attack(startup/active/recovery), Dodge(i-frames), Guard, Grab, Stagger, Knockdown, Airborne, Dead.
- Cancel windows e buffer de input de 150 ms. Hit-stop 40–90 ms, screen shake leve, números de dano.
- Tudo em unidades de **frame a 60 fps lógico** (1 frame = 16,67 ms) convertidos para ticks do servidor.

## 6. Performance (orçamentos obrigatórios — browser, GPU integrada média / PC médio)
| Item | Meta |
|---|---|
| FPS | 60 (mín. 45 em low) |
| Frame time | ≤ 16 ms (CPU ≤ 8 ms) |
| Draw calls | ≤ 600 cena; ≤ 150 por personagem NÃO é aceitável → **≤ 6 por personagem** |
| Triângulos de cena | ≤ 1,5 M (high), ≤ 600 k (low) |
| Personagem principal | 40–60 k tris (LOD0), LOD1 20 k, LOD2 8 k, LOD3 2 k/impostor |
| Personagem NPC/outros jogadores | LOD por distância; ≤ 25 jogadores LOD0/1 visíveis; resto LOD2+ |
| Ossos | ≤ 70 por personagem (skinning na GPU) |
| Texturas | KTX2; atlas por personagem 2048² (high) / 1024² (low) |
| Download inicial (até jogar) | ≤ 25 MB; resto em streaming |
| Memória JS+GPU | ≤ 1,5 GB high; ≤ 700 MB low |
| Rede | ≤ 20 KB/s down, ≤ 4 KB/s up por jogador em combate |
| Tick servidor | ≤ 10 ms p99 para 200 entidades/zona |
Use **instancing**, **GPU skinning com textura de ossos**, **frustum/occlusion culling**, **LOD**, **object pools**, **Web Workers** (física client/assets decode) e **OffscreenCanvas** quando útil. Qualidade configurável: Low/Med/High/Ultra, com auto-detecção e fallback.

## 7. Arte e render (resumo; detalhes em CHARACTER_PIPELINE.md)
- Look: **anime semi-realista** (proporções ~7,5 cabeças, rosto estilizado, pele com SSS falso, cabelo em cards/ribbons com anisotropia, shading cel suave de 3 tons + ramp texture, rim light, outline por inverted hull/pós-processo, bloom discreto).
- Personagens procedurais = **parâmetros + kit modular + morph targets**, NÃO malha gerada do zero por ruído (qualidade baixa). Seed → mesmo resultado sempre (determinístico).
- Todos adultos. Sem nudez. Armaduras com variações de cobertura por design, não por "despir".

## 8. Definição de Pronto (DoD)
Uma tarefa só está pronta se: compila; lint/typecheck/testes passam; critérios de aceite do milestone atendidos; métricas dentro do orçamento; docs atualizadas; sem TODO sem issue.

## 9. O que NÃO fazer
- Não reescrever módulos inteiros sem ADR. Não mudar protocolo sem versionar (`PROTOCOL_VERSION`).
- Não colocar lógica autoritativa no client. Não usar `Math.random`/`Date.now` na simulação.
- Não baixar/copiar assets protegidos. Usar CC0 (Kenney, Quaternius, Mixamo-like só se licença permitir) ou gerar/placeholder.
- Não fazer features de monetização predatória (loot box pago com dinheiro real sem odds públicas, pay-to-win de poder).
