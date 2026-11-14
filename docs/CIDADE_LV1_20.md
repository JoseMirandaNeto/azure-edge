# Cidade Inicial — Cidade de Serket (lv 1–20)

Fonte de verdade em dados: `packages/gamedata/data/city.json` (validado por
`checkCity` em `packages/gamedata/src/index.ts`) + zona espacial em
`packages/gamedata/data/zones.json` (id `cidade_serket`, segura, bioma `meadow`).

## 1. Lore

Há duzentos anos, quando a Fenda Azure se abriu pela primeira vez sobre
Haeran, um oásis de lótus azul brotou no meio do deserto — e ao redor dele
nasceu a Cidade de Serket. A antiga Vila Lótus cresceu ao redor do oásis e
virou cidade; a Praça do Oásis mantém o motivo do lótus. A cidade vive do
comércio das caravanas e da proteção das Lâminas Azuis, mercenários que
caçam os monstros que a Fenda despeja nas Dunas. Sob as areias dormem as
Tumbas Soterradas, e no coração do Ermo ergue-se o Templo de Serket, onde
a Rainha Escorpião aguarda quem ousar desafiar a Fenda.

Todo herói de Haeran começa aqui, entre o lv 1 e o lv 20, antes de partir
para a Mina Carmesim. Serket é **mulher, híbrida humana-escorpião** — nunca
múmia encapuzada masculina (decisão de design do Jose, 2026-11-11).

## 2. Distritos (5)

| Distrito | Função no jogo |
|---|---|
| Praça do Oásis | Coração da cidade: fonte de lótus azul, quadro de missões, ponto de encontro das Lâminas Azuis. Spawn inicial. |
| Bazar das Especiarias | Comércio: loja, leilão, ferreiro (refino), herbalista. |
| Templo do Sol | Cura, poções, lore da Fenda Azure (Sacerdotisa Nara). |
| Quartel das Lâminas | Treino, arsenal, missões de combate (Capitã Mira). |
| Muralha de Jade | Muralha que protege a cidade do Ermo; portão norte → Dunas de Serket. |

## 3. NPCs (8, cada um com função)

| NPC | Papel | Distrito | Função |
|---|---|---|---|
| Capitã Mira | Líder das Lâminas Azuis | Quartel | Missões de combate + Prova das Lâminas |
| Sacerdotisa Nara | Cura | Templo do Sol | Cura, poções, lore da Fenda |
| Mercador Zed | Loja | Bazar | Loja geral + leilão |
| Ferreiro Kael | Ferreiro | Bazar | Reparo e refino (até +7 sem risco de destruição) |
| Guia do Oásis | Portal | Praça do Oásis | Portais: Dunas + entradas das instâncias |
| Ancião Hakim | Lore | Praça do Oásis | História de Serket e das Tumbas |
| Herbalista Yara | Consumíveis | Bazar | Ervas, consumíveis de cura/buff |
| Estalajadeira Lina | Estalagem | Praça do Oásis | Descanso (regenera HP/MP), ponto de retorno |

## 4. Quests — cadeia única de 12 (lv 1–20)

Uma cadeia linear (`nextQuestId`); cada quest destrava a próxima. Recompensas
em XP + ouro (+ item onde indicado). XP total da cadeia: **9.510**.

| # | Quest | Nv | Doador | Objetivo | Recompensa |
|---|---|---|---|---|---|
| 1 | Despertar da Lâmina | 1 | Mira | Matar 5 Formigas Gigantes | 50 XP, 10 ouro, Espada do Novato |
| 2 | Água do Oásis | 2 | Nara | Coletar 3 Águas do Oásis | 80 XP, 15 ouro |
| 3 | Ferrão no Calcanhar | 3 | Mira | Matar 6 Escorpiões do Deserto | 120 XP, 20 ouro |
| 4 | O Bazar Precisa de Você | 4 | Zed | Coletar 4 Sedas do Deserto | 160 XP, 30 ouro |
| 5 | A Primeira Tumba | 5 | Mira | Entrar nas Tumbas Soterradas | 250 XP, 40 ouro, Chave da Tumba |
| 6 | Sussurros nas Areias | 7 | Hakim | Matar 8 Múmias das Tumbas | 400 XP, 60 ouro |
| 7 | O Besouro Rei | 9 | Kael | Matar 6 Besouros do Deserto | 550 XP, 80 ouro |
| 8 | Prova das Lâminas | 10 | Mira | Derrotar 1 Escorpião Alfa (boss de campo) | 800 XP, 120 ouro, Baú de Armadura de Jade |
| 9 | Caravana Perdida | 12 | Zed | Matar 5 Cultistas de Serket | 1.000 XP, 150 ouro |
| 10 | O Culto de Serket | 14 | Hakim | Matar 4 Múmias Anciãs | 1.300 XP, 180 ouro |
| 11 | O Templo de Serket | 16 | Mira | Entrar no Templo de Serket | 1.800 XP, 250 ouro, Selo do Templo |
| 12 | A Fenda se Abre | 18 | Nara | Derrotar Serket (boss final da instância) | 3.000 XP, 500 ouro, Ferrão de Serket |

Notas de design:
- A quest 5 destrava a entrada da instância **Tumbas Soterradas**; a quest 11
  destrava o **Templo de Serket** (ver `docs/INSTANCIAS.md`).
- A quest 8 é a "prova de classe": o Escorpião Alfa é um boss de campo
  soloável no lv 10, porta de entrada para o conteúdo de grupo.
- A cadeia leva o jogador do lv 1 ao ~lv 20 somada ao grind de campo; não é
  obrigatório fazer tudo — as quests são o caminho guiado, não um trilho.

## 5. Mobs do entorno por faixa de nível

| Faixa | Área | Mobs |
|---|---|---|
| lv 1–4 | Oásis dos Nômades | Formiga Gigante, Escorpião do Deserto |
| lv 5–7 | Tumbas Soterradas (arredores) | Múmia das Tumbas, Besouro do Deserto |
| lv 8–10 | O Ermo de Serket | Escorpião Alfa, Besouro do Deserto |
| lv 11–15 | Ermo de Serket / Ruínas | Cultista de Serket, Múmia Anciã |
| lv 16–20 | Templo de Serket (arredores) | Golem de Areia, Cultista de Serket |

Stats em `packages/gamedata/data/mobs.json`. O lobo continua fora do escopo
(decisão M1) — volta em zona posterior, se fizer sentido.

## 6. O que falta para implementar (M3/M4)

- Geometria da cidade (praça, bazar, templo, quartel, muralha) no client;
  hoje só existe o registro espacial em `zones.json`.
- Sistema de quests no servidor (aceitar/entregar, tracking, recompensas).
- NPCs com diálogo e função (loja, refino, cura, portal) — hoje só dados.
- Portais cidade ↔ Dunas ↔ instâncias (o Guia do Oásis é o ponto de entrada).
