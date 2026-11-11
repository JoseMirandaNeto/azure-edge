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

## M3 — Classes e Skills (3 semanas)
Blade + Warden completas (8 skills cada), árvore de skills, agarrar/arremessar, bosses (1), HUD completo, gamepad.

## M4 — MMO Base (4 semanas)
Contas, personagens (Postgres), zonas persistentes, interest management, chat, party, inventário/equip, loot, NPC/quests simples, WebTransport.
**Aceite**: bots: 200 jogadores/zona, tick p99 ≤10 ms, ≤20 KB/s por client.

## M5 — Dungeon e Endgame (4 semanas)
Dungeon instanciada de 4 jogadores com boss de 3 fases, refino, mercado, guild básica.

## M6 — Mundo e Conteúdo (6+ semanas)
3 zonas, montaria, Arqueira e Mística, eventos, ranking, localização (pt-BR/en/ko/ja).

## M7 — PvP e War (4 semanas)
Arena e War de guild 20v20, balanceamento, anti-cheat avançado.

## M8 — Beta aberto + Port nativo (ADR)
Telemetria, otimização, loja cosmética, decisão e protótipo de client PC/console (Unity/Unreal ou wrapper).

## Regra de milestone
Cada milestone termina com: build deployável, vídeo/gif, relatório de métricas, ADRs atualizados, lista de dívida técnica.
