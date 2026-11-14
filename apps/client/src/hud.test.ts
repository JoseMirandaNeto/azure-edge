/**
 * Testes da lógica pura do HUD (hud.ts). Nada aqui toca o DOM: só as
 * funções exportadas — formatação, ping, mundo→mapa, quests, party.
 * Rodar: `pnpm --filter @azure-edge/shared exec vitest run --root apps/client src/hud.test.ts`
 * (o client ainda não tem vitest próprio; usa o binário do workspace).
 */
import { describe, expect, it } from "vitest";
import {
  TOAST_MS,
  WAKING_AFTER_MS,
  buffRemainingS,
  clamp01,
  formatBarNumber,
  formatBuffTime,
  formatCooldown,
  maxStatsFor,
  minimapMobsFromEntities,
  partyMembersFromEntities,
  pingClass,
  questObjectiveLabel,
  skillIconFor,
  worldToMap,
} from "./hud.js";
import type { EntityState } from "@azure-edge/shared";

describe("formatCooldown", () => {
  it("inteiros sem decimal, em pt-BR", () => {
    expect(formatCooldown(6)).toBe("6 s");
    expect(formatCooldown(0)).toBe("0 s");
  });
  it("fração com vírgula", () => {
    expect(formatCooldown(3.5)).toBe("3,5 s");
    expect(formatCooldown(0.4)).toBe("0,4 s");
  });
  it(">= 60 s vira m:ss", () => {
    expect(formatCooldown(65)).toBe("1:05");
    expect(formatCooldown(120)).toBe("2:00");
  });
  it("nunca negativo", () => {
    expect(formatCooldown(-2)).toBe("0 s");
  });
});

describe("formatBuffTime / buffRemainingS", () => {
  it("arredonda o restante para cima", () => {
    expect(formatBuffTime(7.2)).toBe("8 s");
    expect(formatBuffTime(8)).toBe("8 s");
  });
  it("restante é a diferença em segundos, sem negativo", () => {
    expect(buffRemainingS(8000, 3000)).toBe(5);
    expect(buffRemainingS(3000, 8000)).toBe(0);
  });
});

describe("pingClass", () => {
  it("verde < 120, amarelo < 250, vermelho acima", () => {
    expect(pingClass(0)).toBe("good");
    expect(pingClass(119)).toBe("good");
    expect(pingClass(120)).toBe("warn");
    expect(pingClass(249)).toBe("warn");
    expect(pingClass(250)).toBe("bad");
    expect(pingClass(900)).toBe("bad");
  });
});

describe("formatBarNumber / clamp01", () => {
  it("120/120 e arredondamento", () => {
    expect(formatBarNumber(120, 120)).toBe("120/120");
    expect(formatBarNumber(59.6, 120)).toBe("60/120");
    expect(formatBarNumber(-5, 100)).toBe("0/100");
  });
  it("clamp01", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });
});

describe("skillIconFor", () => {
  it("mapeia as 4 assinaturas para os ícones reais", () => {
    expect(skillIconFor("espadachim_corte_crescente")).toBe("/assets/icon_corte_crescente.png");
    expect(skillIconFor("guerreiro_provocacao")).toBe("/assets/icon_provocacao.png");
    expect(skillIconFor("atirador_disparo_rapido")).toBe("/assets/icon_disparo_rapido.png");
    expect(skillIconFor("curandeiro_bencao_solar")).toBe("/assets/icon_bencao_solar.png");
  });
  it("demais skills usam o atlas como fallback", () => {
    expect(skillIconFor("espadachim_lamina_dancante")).toBe("/assets/atlas_skills.png");
    expect(skillIconFor("skill_inexistente")).toBe("/assets/atlas_skills.png");
  });
});

describe("worldToMap (norte para cima)", () => {
  const px = 200;
  const sizeM = 100;
  it("centro do mundo é o centro do mapa", () => {
    expect(worldToMap(0, 0, sizeM, px)).toEqual({ mx: 100, my: 100 });
  });
  it("norte (+y) fica em cima, sul (-y) embaixo", () => {
    expect(worldToMap(0, 50, sizeM, px)).toEqual({ mx: 100, my: 0 });
    expect(worldToMap(0, -50, sizeM, px)).toEqual({ mx: 100, my: 200 });
  });
  it("leste (+x) fica à direita, oeste à esquerda", () => {
    expect(worldToMap(50, 0, sizeM, px)).toEqual({ mx: 200, my: 100 });
    expect(worldToMap(-50, 0, sizeM, px)).toEqual({ mx: 0, my: 100 });
  });
  it("fora da zona é grampeado dentro do mapa", () => {
    expect(worldToMap(500, -500, sizeM, px)).toEqual({ mx: 200, my: 200 });
  });
});

describe("questObjectiveLabel", () => {
  it("kill usa o nome do mob do gamedata", () => {
    expect(
      questObjectiveLabel({ objective: { type: "kill", target: "formiga", count: 5 } }),
    ).toBe("Derrote 5 Formiga Gigante");
    expect(
      questObjectiveLabel({ objective: { type: "kill", target: "escorpiao", count: 1 } }),
    ).toBe("Derrote Escorpião do Deserto");
  });
  it("collect / enter / boss / talk", () => {
    expect(
      questObjectiveLabel({ objective: { type: "collect", target: "Água do Oásis", count: 3 } }),
    ).toBe("Colete 3× Água do Oásis");
    expect(
      questObjectiveLabel({ objective: { type: "enter", target: "tumbas", count: 1 } }),
    ).toBe("Entre em tumbas");
    expect(
      questObjectiveLabel({ objective: { type: "boss", target: "serket", count: 1 } }),
    ).toBe("Derrote Serket, a Rainha Escorpião");
    expect(
      questObjectiveLabel({ objective: { type: "talk", target: "Capitã Mira", count: 1 } }),
    ).toBe("Fale com Capitã Mira");
  });
});

describe("maxStatsFor", () => {
  it("base da classe sem armadura", () => {
    expect(maxStatsFor("espadachim", null)).toEqual({ maxHp: 100, maxMana: 100, maxStamina: 100 });
    expect(maxStatsFor("guerreiro", null)).toEqual({ maxHp: 140, maxMana: 60, maxStamina: 120 });
  });
  it("soma o bônus de HP da armadura", () => {
    // Tier 2 do Guerreiro (guerreiro_ferro): +10 HP (ver armors.json).
    const tier2 = maxStatsFor("guerreiro", "guerreiro_ferro");
    expect(tier2.maxHp).toBe(150);
  });
  it("classe desconhecida usa 100/100/100", () => {
    expect(maxStatsFor("classe_inexistente", null)).toEqual({ maxHp: 100, maxMana: 100, maxStamina: 100 });
  });
});

const mkEntity = (over: Partial<EntityState>): EntityState => ({
  id: 1,
  kind: "player",
  x: 0,
  y: 0,
  yaw: 0,
  animState: 0,
  hpPct: 100,
  ...over,
});

describe("partyMembersFromEntities", () => {
  it("exclui o jogador local e os mobs", () => {
    const entities = [
      mkEntity({ id: 1, name: "Eu" }),
      mkEntity({ id: 2, name: "Ana", classId: "curandeiro", hpPct: 75 }),
      mkEntity({ id: 3, kind: "mob", name: "Escorpião", hpPct: 50 }),
    ];
    expect(partyMembersFromEntities(entities, 1)).toEqual([
      { id: 2, name: "Ana", classId: "curandeiro", hpPct: 75 },
    ]);
  });
  it("nome e classe padrão quando ausentes", () => {
    expect(partyMembersFromEntities([mkEntity({ id: 7 })], 1)).toEqual([
      { id: 7, name: "Jogador #7", classId: "espadachim", hpPct: 100 },
    ]);
  });
});

describe("minimapMobsFromEntities", () => {
  it("só mobs dentro do raio de interesse", () => {
    const entities = [
      mkEntity({ id: 1, kind: "mob", x: 10, y: 0 }),
      mkEntity({ id: 2, kind: "mob", x: 500, y: 0 }),
      mkEntity({ id: 3, kind: "player", x: 5, y: 0 }),
    ];
    expect(minimapMobsFromEntities(entities, 0, 0, 60)).toEqual([{ x: 10, y: 0 }]);
  });
});

describe("constantes de tempo do HUD", () => {
  it("aviso de servidor acordando após 5 s; toast some após 4 s", () => {
    expect(WAKING_AFTER_MS).toBe(5000);
    expect(TOAST_MS).toBe(4000);
  });
});
