# Instâncias — 2 dungeons para 8 jogadores

Fonte de verdade em dados: `packages/gamedata/data/dungeons.json` (validado
por `checkDungeons` em `packages/gamedata/src/index.ts`). Bosses com mob
próprio em `mobs.json` (`neferet`, `serket`).

## Regras comuns (as duas instâncias)

- **Limite: 8 jogadores.** O 9º pedido de entrada é rejeitado. Não há
  preenchimento automático: o grupo entra com 1–8 jogadores (recomendado 8).
- **Composição recomendada**: 1 Guerreiro (tank), 1–2 Curandeiros, resto dano
  (Espadachim + Atirador). Sem trinity rígida: um grupo sem Curandeiro
  consegue limpar com poções, mas o boss final pune.
- **Entrada**: pelo Guia do Oásis na Cidade de Serket, após a quest de
  destrave (q05 para Tumbas, q11 para Templo). A instância é uma zona
  separada (processo próprio, tick 30 Hz, AGENTS.md §1).
- **Lockout (loot)**: cada personagem só pode saquear o boss 1 vez por
  período — 8 h nas Tumbas, 24 h no Templo. Entrar de novo é permitido
  (ajudar amigos), mas sem loot do boss até o lockout expirar.
- **Telegraphs**: todos os ataques de boss/elite têm decal no chão de
  0,8–1,2 s antes do impacto (COMBAT_SPEC.md). Sem one-shot sem aviso.
- **Morte**: revive no início da sala atual após 10 s; wipe (grupo todo
  morto) reinicia no portal de entrada, boss com HP cheio.

## 1. Tumbas Soterradas — lv 5–12 (recomendado 10)

Entrada: Cidade de Serket → Guia do Oásis → quest `q05_primeira_tumba`.
Lockout: **8 h**. Mobs: múmias (lv 8), formigas (lv 7), besouros (lv 8).

### Encontros (4)

| # | Encontro | Tipo | Mecânica |
|---|---|---|---|
| 1 | Sala da Entrada | Trash | Múmias em pares; priorize o Cultista antes que ele cure as múmias. |
| 2 | Corredor das Armadilhas | Trash | Placas de pressão no chão (decal vermelho 1,2 s): saia do círculo antes da lança disparar. |
| 3 | Besouro Guardião | Elite | Carapaça: DEF alta até a postura quebrar; telegrafa investida em linha (decal 0,8 s). |
| 4 | **Neferet, a Sacerdotisa Mumificada** | Boss (lv 12, HP 4.500 ×3) | Ver abaixo. |

### Boss: Neferet (3 fases)

- **Fase 1 (100–50% HP)**: invoca 2 múmias a cada 25% de HP perdido.
  Prioridade: matar as invocadas antes de voltar o dano no boss.
- **Fase 2 (< 50% HP)**: chuva de areia — decal circular no chão, saia em
  1,0 s ou receba dano em área.
- **Fase 3 (< 25% HP)**: enrage — velocidade de ataque +30%; quebre a
  postura (poise 300) para interromper.

### Loot

| Item | Raridade | Chance |
|---|---|---|
| Bandagem da Sacerdotisa | Raro | 50% |
| Armadura de Jade Carmesim (Guerreiro T2) | Épico | 25% |
| Essência da Tumba | Incomum | 100% |

## 2. Templo de Serket — lv 13–20 (recomendado 18)

Entrada: Cidade de Serket → Guia do Oásis → quest `q11_templo_serket`.
Lockout: **24 h**. Mobs: múmias (lv 15), escorpiões (lv 14), besouros (lv 15).

### Encontros (4)

| # | Encontro | Tipo | Mecânica |
|---|---|---|---|
| 1 | Pátio dos Cultistas | Trash | Cultistas canalizam à distância (cone 6 m); interrompa com stagger ou desvie do cone. |
| 2 | Golem de Areia | Elite | Soco em área telegrafado (decal 1,2 s); após o soco, fica 2 s vulnerável (dano ×1,5). |
| 3 | Ponte do Ferrão | Trash | Escorpiões Alfa empurram para fora da ponte; Guerreiro segura a frente, Atirador limpa os lados. |
| 4 | **Serket, a Rainha Escorpião** | Boss (lv 20, HP 9.000 ×4) | Ver abaixo. |

### Boss: Serket (3 fases)

Serket é **mulher, híbrida humana-escorpião** (cauda fina com ferrão, sem
pinça grossa — design aprovado na tela de carregamento, seed 20261159).

- **Fase 1 (100–66% HP)**: cauda com ferrão — golpe em arco de 270°
  telegrafado (decal 1,0 s). Fique atrás dela ou fora do arco.
- **Fase 2 (< 66% HP)**: invoca 2 Escorpiões Alfa; Serket ganha
  super-armor durante a invocação (não adianta focar nela — limpe os adds).
- **Fase 3 (< 33% HP)**: chuva de veneno — poças verdes no chão (dano por
  segundo, saia de cima); **enrage aos 5 min** (dano +50% — corrida contra
  o relógio).

### Loot

| Item | Raridade | Chance |
|---|---|---|
| Ferrão de Serket | Lendário | 15% |
| Égide de Serket (Guerreiro T3) | Épico | 30% |
| Traje da Lua Carmesim (Espadachim T3) | Épico | 30% |
| Essência Azure | Raro | 100% |

## 3. O que falta para implementar (M3/M4)

- Instanciamento no servidor (criar/destruir zona por grupo, cap de 8,
  lockout persistido por personagem).
- Geometria das duas dungeons (salas, corredores, armadilhas, ponte).
- IA de boss com fases: **Neferet implementada no servidor** (summon 2
  múmias a 75%/50% HP, chuva de areia com telegraph de 1,0 s a partir de
  50% HP, enrage +30% de velocidade de ataque abaixo de 25% HP,
  interrompido por quebra de poise — ver `world.ts` `NeferetBossState`).
  **Serket ainda usa a IA genérica de M1** (próxima rodada).
- Sistema de loot/rolagem por grupo e lockout no `server-api`.
- Balanceamento real: HP/ATQ dos bosses (4.500/9.000) são chutes para
  8 jogadores — validar em playtest com o grupo completo.
