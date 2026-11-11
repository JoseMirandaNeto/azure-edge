# COMBAT SPEC

## Unidades
Frame lógico = 1/60 s. Servidor converte em ticks (20-30 Hz) mas avalia hitboxes por sub-step de tempo acumulado.

## Estados do personagem
Idle, Move, Attack{startup, active, recovery}, Skill{...}, Dodge{iframes}, Guard, Grab, Throw, Stagger, Knockdown, Getup, Airborne, Dead.

## Ataque básico (exemplo — Blade)
| Golpe | Startup | Active | Recovery | Cancel p/ próximo | Mult ATQ | Poise dmg | Avanço |
|---|---|---|---|---|---|---|---|
| 1 | 7 | 4 | 12 | f10-f22 | 0.9 | 8 | 0.6 m |
| 2 | 6 | 4 | 12 | f9-f22 | 1.0 | 8 | 0.6 m |
| 3 | 9 | 5 | 16 | f13-f26 | 1.3 | 14 | 1.0 m |
| 4 (finisher) | 14 | 6 | 28 | — | 2.0 | 30 + knockdown | 1.4 m |

## Esquiva
Startup 2, i-frames f3–f14, recovery 8, custo 20 stamina, distância 4 m. Cancela recovery de ataque (custa +5 stamina). Esquiva perfeita (quase-acerto nos f3-f8): +mana e slow-mo local 120 ms.

## Guarda / Contra
Guarda reduz 70% dano frontal, drena stamina. Guarda nos primeiros 8 frames = **parry**: stagger no inimigo + janela de contra-ataque.

## Agarrar (Grab)
Alcance 1.6 m, inimigo ≤ "Médio" e sem super-armor. Duração 40 f; segue com: arremessar (dano + knockdown em área ao colidir), golpe pesado, ou usar como escudo. Objetos do cenário (barris, pedras) como projéteis: dano fixo escalado por nível.

## Skills (formato data-driven)
```yaml
id: blade_crescent_slash
cooldown: 6.0
cost: {mana: 18}
startup: 10
active: [{from: 10, to: 16, shape: {type: arc, radius: 3.2, angle: 140}, hit: {mult: 2.2, poise: 20, effect: knockback}}]
recovery: 20
cancelInto: [dodge]
superArmor: {from: 8, to: 18}
vfx: crescent_blue
```
## Dano
`dmg = ATQ * mult * (100/(100+DEF)) * (crit? CRIT_DMG : 1) * rand(0.95,1.05) * stateBonus`; `stateBonus`: x1.25 em stagger, x1.5 em knockdown/airborne (1ª vez por combo), x0.8 após 5 acertos (anti-infinito: "decaimento de combo").
Crit chance base 5% (cap 60%). Evasão não existe; apenas esquiva ativa.

## Poise / Stagger
Cada mob tem poise e regeneração. Poise ≤ 0 → Stagger 1.2 s (mob grande: 0.8 s) e reset do poise com imunidade de 4 s.

## Feedback (juice) obrigatório
Hit-stop 3–5 frames (acerto) / 6–9 (crítico/finisher); knockback com curva; flash de material; faíscas/sangue estilizado (toggle); câmera: FOV pulse leve e shake ≤ 0.15; som com camadas; número de dano com cor por tipo.

## Alvo e câmera
Sem tab-target; assist de mira suave (cone 35°) para melee. Câmera de terceira pessoa com colisão, lock-on opcional (clique do meio/R3) em bosses.

## Netcode de combate
- Client inicia animação imediatamente (prediction). Servidor valida e confirma; se rejeitar (cooldown/mana), client faz rollback visual (cancela animação com blend de 80 ms).
- Hit detection autoritativa no servidor com rewind máx. 150 ms para alvos jogadores; mobs usam posição atual.
- Eventos de dano replicados com `eventId` para sincronizar VFX/SFX.

## Bosses (template)
3 fases, ataques telegrafados (decal no chão 0.6–1.2 s), 1 mecânica de grupo (ex.: correntes, pilares), enraged timer, partes quebráveis, drops garantidos de material.
