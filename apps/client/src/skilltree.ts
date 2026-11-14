/**
 * Árvore de skills do Azure Edge — lógica pura (testada em skilltree.test.ts).
 *
 * CORREÇÃO do usuário (2026-11-14): NÃO há ícones novos para as outras 12
 * skills e elas NÃO serão implementadas agora. A árvore mostra só os 4 nós
 * iniciais — as 4 assinaturas, uma por classe, com ícone real e detalhe
 * completo — e os demais slots aparecem como ocultos/vazios ("???", sem
 * arte e sem funcionalidade inventada). Nada aqui inventa nome, número ou
 * efeito para uma skill que ainda não existe.
 *
 * Nós da árvore:
 * - raiz: a assinatura da classe atual (desbloqueada, funciona no servidor).
 * - galhos: as assinaturas das outras 3 classes (ícone + detalhe completos,
 *   marcadas "Outra classe" — não podem ser aprendidas por este personagem).
 * - base: 4 slots ocultos ("???") — skills futuras, chegam em M3.
 *
 * Progressão (nv/XP/pontos) é LOCAL (localStorage): o servidor ainda não
 * envia XP nem nível. Começa em nv 1, 0 XP, 0 pontos — sem número inventado.
 */
import { SKILLS, classById, type SkillData } from "@azure-edge/gamedata";

/** Ícones reais das 4 assinaturas (assets aprovados em public/assets). */
export const SIGNATURE_ICONS: Readonly<Record<string, string>> = {
  espadachim_corte_crescente: "/assets/icon_corte_crescente.png",
  guerreiro_provocacao: "/assets/icon_provocacao.png",
  atirador_disparo_rapido: "/assets/icon_disparo_rapido.png",
  curandeiro_bencao_solar: "/assets/icon_bencao_solar.png",
};

/** As 4 skills iniciais: uma assinatura por classe. */
export const SIGNATURE_SKILL_IDS: readonly string[] = [
  "espadachim_corte_crescente",
  "guerreiro_provocacao",
  "atirador_disparo_rapido",
  "curandeiro_bencao_solar",
];

/** Ícone da skill na árvore: só as 4 assinaturas têm ícone real. */
export function skillTreeIconFor(skillId: string): string | null {
  return SIGNATURE_ICONS[skillId] ?? null;
}

export function isSignatureSkill(skillId: string): boolean {
  return SIGNATURE_SKILL_IDS.includes(skillId);
}

export function signatureSkillOf(classId: string): SkillData | undefined {
  const cls = classById(classId);
  if (!cls) return undefined;
  return SKILLS.find((s) => s.id === cls.skillId);
}

export type SkillNodeState = "unlocked" | "other-class" | "hidden";

export interface TreeNodeView {
  /** Id estável do nó (skillId ou "oculta-N"). */
  id: string;
  skillId: string | null;
  label: string;
  state: SkillNodeState;
  /** Classe dona da skill (null nos slots ocultos). */
  classId: string | null;
  icon: string | null;
  /** Posição na árvore: linha 0 = raiz, 1 = galhos, 2 = slots ocultos. */
  row: 0 | 1 | 2;
  /** Centro horizontal do nó, em % da largura da árvore. */
  xPct: number;
}

/**
 * Os 8 nós da árvore, em ordem de desenho: raiz (assinatura da classe
 * atual), 3 galhos (assinaturas das outras classes) e 4 slots ocultos.
 */
export function skillTreeNodes(classId: string): TreeNodeView[] {
  const nodes: TreeNodeView[] = [];
  const mine = signatureSkillOf(classId);
  if (mine) {
    nodes.push({
      id: mine.id,
      skillId: mine.id,
      label: mine.name,
      state: "unlocked",
      classId: mine.classId,
      icon: skillTreeIconFor(mine.id),
      row: 0,
      xPct: 50,
    });
  }
  const others = SKILLS.filter(
    (s) => isSignatureSkill(s.id) && s.classId !== classId,
  );
  const otherX = [16.7, 50, 83.3];
  others.forEach((s, i) => {
    nodes.push({
      id: s.id,
      skillId: s.id,
      label: s.name,
      state: "other-class",
      classId: s.classId,
      icon: skillTreeIconFor(s.id),
      row: 1,
      xPct: otherX[i] ?? 50,
    });
  });
  const hiddenX = [12.5, 37.5, 62.5, 87.5];
  for (let i = 0; i < 4; i++) {
    nodes.push({
      id: `oculta-${i + 1}`,
      skillId: null,
      label: "???",
      state: "hidden",
      classId: null,
      icon: null,
      row: 2,
      xPct: hiddenX[i] ?? 50,
    });
  }
  return nodes;
}

/** Rótulo de estado do nó, em pt-BR. */
export function nodeStateLabel(node: TreeNodeView): string {
  switch (node.state) {
    case "unlocked":
      return "Desbloqueada · ativa (Q)";
    case "other-class": {
      const clsName = node.classId ? (classById(node.classId)?.name ?? node.classId) : "";
      return `Outra classe · ${clsName}`;
    }
    case "hidden":
      return "Oculta · em breve (M3)";
  }
}

/** Linhas de efeito de uma skill, derivadas do gamedata (sem inventar). */
export function skillEffectLines(skill: SkillData): string[] {
  const lines: string[] = [];
  const mults = skill.active
    .map((a) => a.hit.mult)
    .filter((m): m is number => typeof m === "number");
  const maxMult = mults.length > 0 ? Math.max(...mults) : 0;
  const heals = skill.active
    .map((a) => a.hit.heal)
    .filter((h): h is number => typeof h === "number");
  const maxHeal = heals.length > 0 ? Math.max(...heals) : 0;
  if (maxMult > 0) {
    const cls = classById(skill.classId);
    const baseAtk = cls?.base.atk ?? 10;
    lines.push(`Dano: até ${maxMult.toFixed(1).replace(".", ",")}× o ataque (≈ ${Math.round(maxMult * baseAtk)} de dano base)`);
  }
  if (maxHeal > 0) lines.push(`Cura: ${maxHeal} de HP`);
  const shape = skill.active[0]?.shape;
  if (shape?.type === "arc") {
    lines.push(`Área: arco de ${shape.angle ?? "?"}° e ${shape.radius ?? "?"} m`);
  } else if (shape?.type === "cone") {
    lines.push(`Área: cone de ${shape.angle ?? "?"}° e ${shape.radius ?? "?"} m`);
  } else if (shape?.type === "self") {
    lines.push("Área: em si mesmo / ao redor");
  }
  if (skill.taunt) {
    lines.push(
      `Provoca mobs num raio de ${skill.taunt.radiusM} m por ${skill.taunt.durationS} s e ganha ${skill.taunt.tempHp} de vida temporária`,
    );
  }
  if (skill.buff) {
    lines.push(
      `Reduz o dano recebido em ${Math.round(skill.buff.damageReduction * 100)}% por ${skill.buff.durationS} s (raio ${skill.buff.radiusM} m)`,
    );
  }
  const effects = skill.active
    .map((a) => a.hit.effect)
    .filter((e): e is "knockback" | "knockdown" => typeof e === "string");
  if (effects.includes("knockdown")) lines.push("Efeito: derruba os inimigos");
  else if (effects.includes("knockback")) lines.push("Efeito: empurra os inimigos");
  if (skill.superArmor) {
    lines.push(`Super-armadura do frame ${skill.superArmor.from} ao ${skill.superArmor.to}`);
  }
  return lines;
}

/** Rótulo do tipo da skill, em pt-BR. */
export function skillKindLabel(kind: SkillData["kind"]): string {
  switch (kind) {
    case "damage":
      return "Dano";
    case "heal":
      return "Cura";
    case "taunt":
      return "Provocação";
    case "buff":
      return "Buff";
    case "mobility":
      return "Mobilidade";
  }
}

// ---------------------------------------------------------------------------
// Progressão local (nv / XP / pontos de skill) — localStorage, sem servidor.
// ---------------------------------------------------------------------------

export interface LocalProgress {
  level: number;
  xp: number;
  skillPoints: number;
}

export const PROGRESS_STORAGE_KEY = "azure-edge:progress:v1";

export const DEFAULT_PROGRESS: LocalProgress = { level: 1, xp: 0, skillPoints: 0 };

/** XP para subir do nível `level` para o próximo. */
export function xpToNextLevel(level: number): number {
  return 100 + Math.max(0, level - 1) * 50;
}

export function loadProgress(): LocalProgress {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROGRESS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_PROGRESS };
    const p = parsed as Partial<LocalProgress>;
    return {
      level: typeof p.level === "number" && p.level >= 1 ? Math.floor(p.level) : 1,
      xp: typeof p.xp === "number" && p.xp >= 0 ? Math.floor(p.xp) : 0,
      skillPoints:
        typeof p.skillPoints === "number" && p.skillPoints >= 0 ? Math.floor(p.skillPoints) : 0,
    };
  } catch {
    return { ...DEFAULT_PROGRESS };
  }
}

export function saveProgress(progress: LocalProgress): void {
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

/** Fração da barra de XP (0–1) no nível atual. */
export function xpFraction(progress: LocalProgress): number {
  const need = xpToNextLevel(progress.level);
  return Math.min(1, Math.max(0, progress.xp / need));
}
