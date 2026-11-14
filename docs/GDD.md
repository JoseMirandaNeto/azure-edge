# GDD — Azure Edge (MMORPG Action Hack & Slash)

## 1. Pitch
Um MMORPG de ação em tempo real: combate físico e visceral estilo Vindictus (esquiva, agarrar, arremessar objetos, mobs gigantes), loop de grind/classes/skills com sensação de MMO clássico estilo Cabal (combos com skills em hotkeys, party, guild, war) e mundo vivo com montarias/cidades estilo Aika. Roda no browser em 1 clique; mais tarde PC e consoles.
**Pilares**: (1) Combate com peso e responsividade; (2) Personagens lindos e customizáveis; (3) Entrar e jogar em <30 s; (4) Cooperação em dungeons e guerra de guildas.

## 2. Público e plataformas
Jogadores 16+ de MMO/ação (BR, LATAM, SEA, EU). Browser (Chrome/Edge/Safari/Firefox, WebGPU→WebGL2), depois PC (cliente nativo) e console. Controles: teclado+mouse, gamepad (desde o início, p/ console).

## 3. Mundo e lore (resumo)
Continente de **Haeran**, inspirado em fantasia asiática (reinos de montanha, cidades portuárias, templos, ruínas flutuantes). Uma fenda ("Azure Rift") despeja monstros; as Lâminas Azuis (jogadores) são mercenários/heróis. Todos os personagens jogáveis são adultos.
**Cidade inicial — Cidade de Serket (lv 1–20)**: nascida ao redor de um oásis de lótus azul quando a Fenda Azure se abriu pela primeira vez; a antiga Vila Lótus cresceu e virou cidade. 5 distritos (Praça do Oásis, Bazar das Especiarias, Templo do Sol, Quartel das Lâminas, Muralha de Jade), 8 NPCs com função e 12 quests encadeadas lv 1–20 (ver `docs/CIDADE_LV1_20.md` e `city.json`). Zonas do entorno: **Dunas de Serket** (lv 1–10: Oásis dos Nômades lv 1–4 — área segura, missões de insetos pequenos; Tumbas Soterradas lv 5–7 — primeiras múmias e a história do boss; O Ermo de Serket lv 8–10 — área mais cinzenta e perigosa, boss Serket, mulher híbrida humana-escorpião que reside em seu templo), **Mina Carmesim** (lv 10–20), **Planície dos Ventos** (lv 20–30), **Cidadela Rachada** (endgame inicial).
**Apresentação 2.5D** (ADR-008): mundo 3D com câmera oblíqua fixa (~35°, distância 8–10 m), sem câmera livre de 3ª pessoa; rotação opcional em 4 ângulos de 90°.

## 4. Loop de jogo
- Curto (2-5 min): lutar contra grupo de mobs, usar skills, coletar drops.
- Médio (20-40 min): quest chain / dungeon instanciada (**8 jogadores**), boss com mecânicas.
- Longo (semanas): classe/awakening, equipamento (upgrade/refino), guild, war, ranking, raids de 8-16 jogadores.

## 5. Classes (lançamento: 4; 2 variantes visuais de gênero com igual conteúdo)
| Classe | Papel | Arma | Identidade |
|---|---|---|---|
| Guerreiro (ex-Guardião) | Tank/controle | Escudo e arma | Agarrar, taunt, quebrar postura |
| Atirador (Gunner) | Dano à distância | Espingarda | Tiro pesado, mobilidade, pressão à distância |
| Curandeiro (ex-Clérigo) | Suporte/cura sagrada | Foco sagrado | Cura, buffs, proteção |
| Espadachim | Dano corpo a corpo/combo | Duas espadas | Combos rápidos, contra-ataque |
Qualquer classe pode ser de qualquer gênero (customização). Futuro: Assassino (adagas), Lanceiro, Invocador.
> Renome 2026-11-13 (pedido do Jose, ADR-010): Guardião → **Guerreiro**, Clérigo → **Curandeiro**. As skills do M1 foram preservadas (só os ids mudaram: `guerreiro_provocacao`, `curandeiro_bencao_solar`).
> Decisão de design 2026-11-11 (Jose): este conjunto substitui o original (Lâmina/Guardião/Arqueira/Mística). Nomes confirmados: Clérigo e Espadachim. Skills do M1 (1 por classe, pt-BR): Espadachim — Corte Crescente; Guardião — Provocação (taunt + vida temporária, custa mana); Atirador — Disparo Rápido (2 tiros, recarga rápida); Clérigo — Bênção Solar (buff de proteção, reduz dano recebido). Classe de teste do M1: Espadachim. Mobs do M1: insetoides (escorpiões, formigas gigantes, besouros) e múmias; o lobo fica para depois. Mapa do M1: Dunas de Serket, deserto estilo Sigmund (Aika) como referência de estilo apenas — assets e nomes originais, sem copiar o mapa.

### 5.1 Skills — 4 por classe (dados em `skills.json`)
| Classe | Skills (nome pt-BR) |
|---|---|
| Espadachim | Corte Crescente (assinatura, arco 140°, 2,2x) · Lâmina Dançante (3 giros) · Contra Azure (postura de contra-ataque) · Julgamento Duplo (ultimate, 3,5x, knockdown) |
| Guerreiro | Provocação (taunt 10 m/5 s + 30 HP temp.) · Golpe Esmagador (2,0x, knockdown) · Muralha de Aço (buff −50% dano, 5 m/6 s) · Investida do Touro (mobilidade + dano) |
| Atirador | Disparo Rápido (assinatura, 2 tiros) · Chuva de Chumbo (5 salvas em cone) · Tiro Certeiro (3,0x, 16 m) · Recuo Tático (mobilidade, recuo 5 m) |
| Curandeiro | Bênção Solar (buff −30% dano, 6 m/8 s) · Luz Curativa (cura 60) · Círculo Sagrado (buff −25% dano em área) · Julgamento Solar (dano sagrado 2,4x) |
Cada skill tem animação e VFX descritos em `skills.json` (`animation`/`vfx`). O Contra Azure promete um contra-ataque ao ser atingido na postura — a resposta automática ainda é trabalho de M3 (hoje só o buff de redução existe como dado).

### 5.2 Stats base (lv 1) e crescimento por nível (`classes.json`)
| Classe | HP | ATQ | DEF | Stamina | Mana | Crescimento/nv (HP/ATQ/DEF) |
|---|---|---|---|---|---|---|
| Espadachim | 100 | 10 | 5 | 100 | 100 | +12 / +2,2 / +0,8 |
| Guerreiro | 140 | 9 | 12 | 120 | 60 | +18 / +1,8 / +1,5 |
| Atirador | 90 | 11 | 4 | 90 | 80 | +10 / +2,6 / +0,6 |
| Curandeiro | 95 | 8 | 6 | 90 | 140 | +11 / +1,6 / +0,9 |
Fórmula: `stat(lv) = base + crescimento × (lv − 1)`.

### 5.3 Armaduras trocáveis — 3 conjuntos por classe (`armors.json`)
Cada classe tem 3 conjuntos (T1 lv 1, T2 lv 8, T3 lv 16) com visual distinto — cor primária/secundária/destaque, aura colorida e material — e bônus pequeno de stat + bônus de conjunto (ex.: T3 do Guerreiro, Égide de Serket: Muralha de Aço +2 s). **Cosmético separado de stat** (transmog): a aparência de qualquer conjunto pode ser aplicada sobre outro sem mudar os números.

## 6. Combate (ver COMBAT_SPEC.md)
- Ataque básico com cadeia de 3-4 golpes; botão de skill (1-8 + 2 ultimates); esquiva com i-frames; guarda; **Agarrar** (inimigos pequenos/médios: arremessar, usar como projétil; objetos do cenário).
- **Stamina** para esquivar/correr; **Mana/Energia** para skills; **Postura (Poise)** do inimigo quebra → stagger/knockdown → janela de dano extra.
- Mobs em horda (10-30) e bosses (mecânicas telegráficas, fases, partes quebráveis).
- Fórmula base de dano: `dano = (ATQ * mult_skill) * (100/(100+DEF)) * crit * variação(0.95-1.05) * bônus_estado`. Detalhes em COMBAT_SPEC.

## 7. Progressão
- Nível 1–60 no lançamento (curva: XP = 100 * lvl^1.9). 
- Árvore de skills por classe (3 ramos), pontos por nível, respec barato.
- Equipamento: raridades Comum/Incomum/Raro/Épico/Lendário; slots: arma, cabeça, tronco, mãos, pernas, pés, 2 acessórios; **cosméticos separados do stat** (transmog).
- Refino +0 a +10 (risco moderado, sem destruição até +7), gemas/runas.
- Montarias (velocidade) a partir do nv. 20, pets cosméticos.

## 8. Social e endgame
Party (4 no campo), **instâncias de 8 jogadores** (Tumbas Soterradas lv 5–12 e Templo de Serket lv 13–20 — ver `docs/INSTANCIAS.md`), Raid (8–16), Guild (nível, banco, quests), Chat (global/zona/party/guild/sussurro), Mercado (leilão com taxa), Troca segura. **War de guild** (PvP 20v20 em mapa, objetivos de torres) e arena 1v1/3v3. Ranking sazonal.

## 9. Economia e monetização (ética)
Moedas: Ouro (soft), Cristais Azuis (premium, só cosméticos/conveniência), Fichas de Dungeon. Monetização: cosméticos, pets, passe de temporada, slots de personagem. **Sem pay-to-win de poder.** Odds públicas para qualquer aleatório pago. Sinks de ouro: refino, reparo, taxa de leilão, teleporte.

## 10. Personagens e arte (ver CHARACTER_PIPELINE.md)
Estética asiática, anime semi-realista. Personagens femininos com sex appeal estilizado: silhueta, figurino, cabelo e animação expressivos, sempre adultas e sem nudez. Masculinos musculosos/moderados, com igual cuidado. Customização: rosto, corpo (sliders), cabelo, cor de pele/olhos, maquiagem, tatuagens leves, figurinos.
**Método (ADR-009, híbrido)**: CharForge procedural (genoma + kit modular + seed determinística) como sistema; a malha TRELLIS2 `base_s20261221` (47.436 tris, 0 furos) como base feminina heroína e referência de proporções; kits modulares de armadura por classe sobre esqueleto humanoide único (~65 ossos). Limites honestos: mãos sem dedos (esconder com manoplas), barra do vestido esgarçada, rosto no clay estranho sem textura.
Direção de arte: paleta azul-jade/vermelho-carmim/dourado; céu vívido, bloom suave; UI inspirada em pergaminho + vidro.

## 11. Áudio
Música orquestral + instrumentos tradicionais (guzheng, erhu, taiko). SFX de impacto com camadas (impacto, material, cauda). Vozes: grunhidos/frases curtas por classe; localização futura.

## 12. UI/UX
HUD: barras HP/MP/Stamina, hotbar 10 slots, minimapa, buffs, chat, quest tracker, party frame. Menus: inventário, skills, mapa, guild, loja. Mouse + gamepad (radial menu). Acessibilidade: tamanho de fonte, daltonismo, remapeamento de teclas, reduzir shake.

## 13. Requisitos técnicos-chave
Ver AGENTS.md §6 e ARCHITECTURE.md. Cliente carrega em ≤25 MB até o primeiro controle; streaming do resto.

## 14. Métricas de sucesso (vertical slice)
- 60 fps com 20 jogadores + 30 mobs visíveis em notebook com iGPU.
- Latência percebida de ataque < 100 ms (animação inicia imediatamente via prediction).
- 80% dos playtesters descrevem o combate como "satisfatório" (teste com 10 pessoas).
- Criador gera 10 personagens únicos distintos de forma convincente por seed em <1 s cada.

## 15. Riscos
| Risco | Mitigação |
|---|---|
| Performance no browser | Budgets, LOD, instancing, Low preset, métrica contínua |
| Netcode de combate de ação | Prediction + reconciliation + rewind limitado; testes com latência simulada 50-200 ms |
| Escopo de MMO | Vertical slice primeiro; 1 zona, 1 dungeon, 2 classes |
| Qualidade de personagem procedural | Kit modular autoral + morphs; não malhas "do zero" |
| Direitos autorais | Só referência de gameplay; assets originais/licenciados |
