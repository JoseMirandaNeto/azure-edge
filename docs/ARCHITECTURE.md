# ARCHITECTURE

## Visão
```
Browser Client (Three.js WebGPU/WebGL2) <--WS/WebTransport--> Gateway --> Zone Server(s) (ECS, Rapier)
                                                               |                 |
                                                         API Server (HTTP)   Redis (presença, pub/sub)
                                                               |
                                                          PostgreSQL
```
## Client
- Loop: `fixedUpdate(60Hz lógico)` p/ input/prediction; `render(rAF)` interpolado.
- Módulos: `input`, `net`, `prediction`, `world` (ECS), `render`, `anim`, `fx`, `ui`, `audio`, `assets` (loader streaming com prioridade e cache IndexedDB).
- Renderer: WebGPURenderer com fallback WebGL2; detectar `renderer.backend.isWebGPUBackend`. Preset de qualidade automático por benchmark de 3 s.
- Animação: state machine + blend tree; animações de ataque guiadas por dados de frame; root motion opcional controlado pelo servidor-validado.
- Culling/LOD/instancing para mobs; **impostors** para jogadores distantes.
- Web Workers: decodificação (Meshopt/KTX2), física local de cenário, pathing de efeitos.

## Server (zona)
- Tick 20 Hz (mundo), 30 Hz (instância). Pipeline: `ler inputs → simular movimento → habilidades/hitboxes → IA → aplicar dano/estados → interest mgmt → snapshots`.
- ECS: Position, Velocity, Health, Stats, CombatState, AIState, Inventory ref, NetOwner.
- IA de mobs: behavior trees em dados (patrulha, aggro, ataque telegrafado, fases de boss).
- Navegação: navmesh (Recast/Detour WASM) gerada offline por zona.
- Persistência: snapshot do personagem ao sair/zona/5 min; transações p/ itens e economia no API server.

## Dados
`packages/gamedata/*.yaml` → validados (Zod) → gerados em `shared` types. Hot-reload em dev.

## Rede
Ver PROTOCOL.md. Canais: confiável-ordenado (chat, inventário, quests) e não-confiável (inputs/snapshots) quando WebTransport; em WS, tudo no mesmo socket com prioridade.

## Portabilidade (PC/console)
- Lógica de jogo (`shared`, protocolo, gamedata) 100% independente de renderer.
- `engine-adapter` define interfaces (Renderer, Input, Audio, Storage). Cliente nativo futuro: opção A) Unity/Unreal consumindo o mesmo protocolo e gamedata; opção B) empacotar o client web (Tauri/Electron) no PC. Console: A. Decisão via ADR no M8.
- Evite APIs exclusivas de browser dentro de `shared`.

## Observabilidade
Logs estruturados (pino), métricas Prometheus (tick ms, entidades, bytes/s), tracing de latência, painel debug in-game (F3): FPS, ms, draw calls, tris, ping, perda de pacotes.

## Segurança
Rate limits, validação de input no servidor, TLS, tokens curtos, sanitização de chat, logs de auditoria de itens/ouro, detecção de anomalias (dano/velocidade impossíveis).
