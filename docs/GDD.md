# GDD — Azure Edge (MMORPG Action Hack & Slash)

## 1. Pitch
Um MMORPG de ação em tempo real: combate físico e visceral estilo Vindictus (esquiva, agarrar, arremessar objetos, mobs gigantes), loop de grind/classes/skills com sensação de MMO clássico estilo Cabal (combos com skills em hotkeys, party, guild, war) e mundo vivo com montarias/cidades estilo Aika. Roda no browser em 1 clique; mais tarde PC e consoles.
**Pilares**: (1) Combate com peso e responsividade; (2) Personagens lindos e customizáveis; (3) Entrar e jogar em <30 s; (4) Cooperação em dungeons e guerra de guildas.

## 2. Público e plataformas
Jogadores 16+ de MMO/ação (BR, LATAM, SEA, EU). Browser (Chrome/Edge/Safari/Firefox, WebGPU→WebGL2), depois PC (cliente nativo) e console. Controles: teclado+mouse, gamepad (desde o início, p/ console).

## 3. Mundo e lore (resumo)
Continente de **Haeran**, inspirado em fantasia asiática (reinos de montanha, cidades portuárias, templos, ruínas flutuantes). Uma fenda ("Azure Rift") despeja monstros; as Lâminas Azuis (jogadores) são mercenários/heróis. Todos os personagens jogáveis são adultos.
Zonas iniciais: **Vila Lótus** (hub), **Floresta do Orvalho** (lv1-10), **Mina Carmesim** (lv10-20), **Planície dos Ventos** (lv20-30), **Cidadela Rachada** (endgame inicial).

## 4. Loop de jogo
- Curto (2-5 min): lutar contra grupo de mobs, usar skills, coletar drops.
- Médio (20-40 min): quest chain / dungeon instanciada (4 jogadores), boss com mecânicas.
- Longo (semanas): classe/awakening, equipamento (upgrade/refino), guild, war, ranking, raids de 8-16 jogadores.

## 5. Classes (lançamento: 4; 2 variantes visuais de gênero com igual conteúdo)
| Classe | Papel | Arma | Identidade |
|---|---|---|---|
| Lâmina (Blade) | Dano corpo a corpo/combo | Espada longa | Combos rápidos, contra-ataque |
| Guardião (Warden) | Tank/controle | Espada e escudo / martelo | Agarrar, taunt, quebrar postura |
| Arqueira (Windshot) | Dano à distância | Arco | Mobilidade, dano crítico, traps |
| Mística (Mystic) | Suporte/AoE | Bastão/leque | Cura, buffs, magias em área |
Qualquer classe pode ser de qualquer gênero (customização). Futuro: Assassino (adagas), Lanceiro, Invocador.

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
Party (4), Raid (8-16), Guild (nível, banco, quests), Chat (global/zona/party/guild/sussurro), Mercado (leilão com taxa), Troca segura. **War de guild** (PvP 20v20 em mapa, objetivos de torres) e arena 1v1/3v3. Ranking sazonal.

## 9. Economia e monetização (ética)
Moedas: Ouro (soft), Cristais Azuis (premium, só cosméticos/conveniência), Fichas de Dungeon. Monetização: cosméticos, pets, passe de temporada, slots de personagem. **Sem pay-to-win de poder.** Odds públicas para qualquer aleatório pago. Sinks de ouro: refino, reparo, taxa de leilão, teleporte.

## 10. Personagens e arte (ver CHARACTER_PIPELINE.md)
Estética asiática, anime semi-realista. Personagens femininos com sex appeal estilizado: silhueta, figurino, cabelo e animação expressivos, sempre adultas e sem nudez. Masculinos com igual cuidado. Customização: rosto, corpo (sliders), cabelo, cor de pele/olhos, maquiagem, tatuagens leves, figurinos.
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
