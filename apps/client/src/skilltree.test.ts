import { describe, expect, it } from "vitest";
import {
  SIGNATURE_SKILL_IDS,
  isSignatureSkill,
  loadProgress,
  nodeStateLabel,
  saveProgress,
  skillEffectLines,
  skillTreeIconFor,
  skillTreeNodes,
  signatureSkillOf,
  xpFraction,
  xpToNextLevel,
} from "./skilltree.js";
import { skillById } from "@azure-edge/gamedata";
import { beforeEach, vi } from "vitest";

function installLocalStorageStub(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string): string | null => store.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      store.set(k, v);
    },
    removeItem: (k: string): void => {
      store.delete(k);
    },
    clear: (): void => {
      store.clear();
    },
  });
}

beforeEach(() => {
  installLocalStorageStub();
});

describe("nós iniciais da árvore", () => {
  it("são as 4 assinaturas, uma por classe", () => {
    expect(SIGNATURE_SKILL_IDS).toHaveLength(4);
    expect(SIGNATURE_SKILL_IDS).toContain("espadachim_corte_crescente");
    expect(SIGNATURE_SKILL_IDS).toContain("guerreiro_provocacao");
    expect(SIGNATURE_SKILL_IDS).toContain("atirador_disparo_rapido");
    expect(SIGNATURE_SKILL_IDS).toContain("curandeiro_bencao_solar");
    for (const id of SIGNATURE_SKILL_IDS) {
      expect(isSignatureSkill(id)).toBe(true);
    }
    // As outras 12 skills NÃO são nós iniciais.
    expect(isSignatureSkill("espadachim_lamina_dancante")).toBe(false);
    expect(isSignatureSkill("curandeiro_luz_curativa")).toBe(false);
  });

  it("ícone real só para as 4 assinaturas; o resto é null (slot oculto)", () => {
    expect(skillTreeIconFor("espadachim_corte_crescente")).toBe("/assets/icon_corte_crescente.png");
    expect(skillTreeIconFor("guerreiro_provocacao")).toBe("/assets/icon_provocacao.png");
    expect(skillTreeIconFor("atirador_disparo_rapido")).toBe("/assets/icon_disparo_rapido.png");
    expect(skillTreeIconFor("curandeiro_bencao_solar")).toBe("/assets/icon_bencao_solar.png");
    expect(skillTreeIconFor("espadachim_lamina_dancante")).toBeNull();
    expect(skillTreeIconFor("espadachim_julgamento_duplo")).toBeNull();
    expect(skillTreeIconFor("skill_inexistente")).toBeNull();
  });

  it("assinatura de cada classe vem do gamedata", () => {
    expect(signatureSkillOf("espadachim")?.id).toBe("espadachim_corte_crescente");
    expect(signatureSkillOf("guerreiro")?.id).toBe("guerreiro_provocacao");
    expect(signatureSkillOf("atirador")?.id).toBe("atirador_disparo_rapido");
    expect(signatureSkillOf("curandeiro")?.id).toBe("curandeiro_bencao_solar");
    expect(signatureSkillOf("classe_inexistente")).toBeUndefined();
  });
});

describe("skillTreeNodes", () => {
  it("espadachim: raiz é o Corte Crescente desbloqueado, galhos são as outras 3, base são 4 ocultos", () => {
    const nodes = skillTreeNodes("espadachim");
    expect(nodes).toHaveLength(8);
    const root = nodes.find((n) => n.row === 0);
    expect(root?.skillId).toBe("espadachim_corte_crescente");
    expect(root?.state).toBe("unlocked");
    expect(root?.icon).toBe("/assets/icon_corte_crescente.png");
    const branches = nodes.filter((n) => n.row === 1);
    expect(branches).toHaveLength(3);
    expect(branches.map((n) => n.state)).toEqual(["other-class", "other-class", "other-class"]);
    expect(branches.every((n) => n.icon !== null)).toBe(true);
    const hidden = nodes.filter((n) => n.row === 2);
    expect(hidden).toHaveLength(4);
    expect(hidden.map((n) => n.state)).toEqual(["hidden", "hidden", "hidden", "hidden"]);
    expect(hidden.every((n) => n.skillId === null && n.icon === null && n.label === "???")).toBe(true);
  });

  it("a raiz muda com a classe; as outras viram galhos", () => {
    const nodes = skillTreeNodes("curandeiro");
    expect(nodes.find((n) => n.row === 0)?.skillId).toBe("curandeiro_bencao_solar");
    expect(nodes.filter((n) => n.row === 1).map((n) => n.skillId)).toContain("espadachim_corte_crescente");
  });

  it("rótulos de estado em pt-BR e sem mentir funcionalidade", () => {
    const nodes = skillTreeNodes("guerreiro");
    const root = nodes.find((n) => n.row === 0);
    const branch = nodes.find((n) => n.row === 1);
    const hidden = nodes.find((n) => n.row === 2);
    expect(root && nodeStateLabel(root)).toMatch(/Desbloqueada/);
    expect(branch && nodeStateLabel(branch)).toMatch(/Outra classe/);
    expect(hidden && nodeStateLabel(hidden)).toMatch(/Oculta · em breve \(M3\)/);
  });
});

describe("skillEffectLines", () => {
  it("Corte Crescente: dano 2,2× e arco 140°/3,2 m, sem número inventado", () => {
    const skill = skillById("espadachim_corte_crescente");
    expect(skill).toBeDefined();
    const lines = skillEffectLines(skill!);
    expect(lines.join(" ")).toMatch(/2,2×/);
    expect(lines.join(" ")).toMatch(/140°/);
    expect(lines.join(" ")).toMatch(/empurra/);
  });

  it("Provocação: raio, duração e vida temporária do gamedata", () => {
    const lines = skillEffectLines(skillById("guerreiro_provocacao")!);
    expect(lines.join(" ")).toMatch(/10 m por 5 s/);
    expect(lines.join(" ")).toMatch(/30 de vida temporária/);
  });

  it("Bênção Solar: redução de dano 30% por 8 s", () => {
    const lines = skillEffectLines(skillById("curandeiro_bencao_solar")!);
    expect(lines.join(" ")).toMatch(/30% por 8 s/);
  });

  it("Disparo Rápido: dano 1,0× e cone de 9 m", () => {
    const lines = skillEffectLines(skillById("atirador_disparo_rapido")!);
    expect(lines.join(" ")).toMatch(/1,0×/);
    expect(lines.join(" ")).toMatch(/cone/);
  });
});

describe("progressão local", () => {
  it("começa em nv 1, 0 XP, 0 pontos", () => {
    expect(loadProgress()).toEqual({ level: 1, xp: 0, skillPoints: 0 });
  });

  it("XP para o próximo nível cresce com o nível", () => {
    expect(xpToNextLevel(1)).toBe(100);
    expect(xpToNextLevel(2)).toBe(150);
    expect(xpToNextLevel(5)).toBe(300);
  });

  it("fração de XP e save/load sobrevivem", () => {
    expect(xpFraction({ level: 1, xp: 50, skillPoints: 0 })).toBeCloseTo(0.5);
    expect(xpFraction({ level: 1, xp: 999, skillPoints: 0 })).toBe(1);
    saveProgress({ level: 3, xp: 40, skillPoints: 2 });
    expect(loadProgress()).toEqual({ level: 3, xp: 40, skillPoints: 2 });
  });

  it("JSON corrompido volta ao padrão", () => {
    localStorage.setItem("azure-edge:progress:v1", "{não-json");
    expect(loadProgress()).toEqual({ level: 1, xp: 0, skillPoints: 0 });
  });
});
