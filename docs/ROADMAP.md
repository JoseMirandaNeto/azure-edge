# ROADMAP (vertical slice → beta)

## M0 — Fundação (1–2 semanas)
Monorepo, CI, Vite client, Three.js WebGPU/WebGL2, cena com terreno, personagem placeholder (capsule + glTF), câmera 3ª pessoa, movimento, servidor autoritativo mínimo, 2+ clients se vendo.
**Aceite**: 60 fps; inputs com prediction; ping simulado 100 ms jogável; `pnpm test` verde; painel F3.

## M1 — Combate Core (2–3 semanas)
Máquina de estados, ataque 4 golpes, esquiva, guarda, hit-stop, hitboxes server-side, 1 mob (lobo) com IA, números de dano, poise/stagger.
**Aceite**: combate "satisfatório" em playtest interno; rollback visual sem glitch; 30 mobs a 60 fps.

## M2 — CharForge v1 (2–3 semanas)
Base mesh F/M, 20 morphs corpo + 20 rosto, 6 cabelos, 6 roupas, shader anime, criador de personagem, seed determinística, LODs, exporte GLB.
**Aceite**: 1000 seeds sem erro; ≤6 draw calls/personagem; LOD0 ≤60k tris; revisão de arte (adultos, sem nudez).

## M3 — Classes, Cidade lv 1–20 e Instâncias de 8 (3–4 semanas)
**Redefinido em 2026-11-13 (ADR-008/009/010; o M3 antigo falava em "Blade + Warden" e dungeon de 4 — substituído):** 4 classes com nomes finais — **Guerreiro, Atirador, Curandeiro, Espadachim** — cada uma com 4 skills data-driven (16 no total, `skills.json`), stats base + crescimento por nível (`classes.json`), 3 conjuntos de armadura por classe com efeito visual distinto (`armors.json`, cosmético separado de stat). **Câmera 2.5D** (oblíqua fixa ~35°, ADR-008). **Cidade de Serket lv 1–20** (5 distritos, 8 NPCs, 12 quests encadeadas, `city.json` + `docs/CIDADE_LV1_20.md`). **2 instâncias de 8 jogadores** — Tumbas Soterradas (lv 5–12, lockout 8 h) e Templo de Serket (lv 13–20, lockout 24 h, boss Serket) — com encontros telegrafados, loot e lockout (`dungeons.json` + `docs/INSTANCIAS.md`). Personagens híbridos (ADR-009): base TRELLIS2 `base_s20261221` importada para `assets/` + rig Mixamo (~65 ossos). Agarrar/arremessar, HUD completo, gamepad.
**Aceite**: as 4 classes jogáveis com as 16 skills; cidade navegável com as 12 quests completáveis; as 2 instâncias limpáveis por grupo de 8; câmera 2.5D com telegraphs legíveis; ≤6 draw calls/personagem; LOD0 ≤60k tris.

## M4 — MMO Base (4 semanas)
Contas, personagens (Postgres), zonas persistentes, interest management, chat, party, inventário/equip, loot, NPC/quests simples, WebTransport.
**Aceite**: bots: 200 jogadores/zona, tick p99 ≤10 ms, ≤20 KB/s por client.

## M5 — Dungeon e Endgame (4 semanas)
Instâncias de **8 jogadores** (o modelo de M3) com bosses de 3 fases, refino, mercado, guild básica. (O texto antigo deste milestone falava em "dungeon instanciada de 4 jogadores" — atualizado para 8 em 2026-11-13, ADR-010.)

## M6 — Mundo e Conteúdo (6+ semanas)
3 zonas, montaria, Arqueira e Mística, eventos, ranking, localização (pt-BR/en/ko/ja).

## M7 — PvP e War (4 semanas)
Arena e War de guild 20v20, balanceamento, anti-cheat avançado.

## M8 — Beta aberto + Port nativo (ADR)
Telemetria, otimização, loja cosmética, decisão e protótipo de client PC/console (Unity/Unreal ou wrapper).

## Regra de milestone
Cada milestone termina com: build deployável, vídeo/gif, relatório de métricas, ADRs atualizados, lista de dívida técnica.
