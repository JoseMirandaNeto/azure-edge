/**
 * HUD do Azure Edge — módulo puro de DOM (sem Three.js, sem rede).
 *
 * Constrói barras, hotbar de skills, buffs, minimapa, chat local, frame de
 * party, tracker de quests, toasts, indicador de zona/ping e botões que
 * disparam CustomEvents (`ae:open-inventory|skills|map|pause`, `ae:use-skill`,
 * `ae:chat-send`). Os menus de inventário/skills/mapa/pausa NÃO são
 * implementados aqui — outro módulo os faz e escuta esses eventos.
 *
 * Honestidade do que é local (sem servidor):
 * - Chat: só local; a mensagem aparece com a marca "(local)".
 * - Quests: progresso local em memória (abates contados via `noteKill`);
 *   o servidor ainda não valida nem recompensa quests.
 * - Cooldowns: locais, a partir do gamedata; o servidor continua sendo a
 *   autoridade (um `onReject` deve chamar `clearSkillCooldown`).
 * - Slots 2-4 da hotbar: só a skill assinatura (Q) é executada pelo
 *   servidor hoje; os demais mostram "Em breve".
 */
import {
  CITY,
  SKILLS,
  armorById,
  classById,
  dungeonById,
  mobById,
  zoneById,
  type SkillData,
} from "@azure-edge/gamedata";
import type { EntityState } from "@azure-edge/shared";

/* ------------------------------------------------------------------ */
/* Funções puras (testáveis em hud.test.ts)                            */
/* ------------------------------------------------------------------ */

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** "6 s", "3,5 s", "1:05" — pt-BR, sem casa decimal quando inteiro. */
export function formatCooldown(remainingS: number): string {
  const s = Math.max(0, remainingS);
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rest = Math.floor(s % 60);
    return `${m}:${String(rest).padStart(2, "0")}`;
  }
  if (Number.isInteger(s)) return `${s} s`;
  return `${s.toFixed(1).replace(".", ",")} s`;
}

/** Tempo restante de buff/debuff: "8 s" ou "1:05". */
export function formatBuffTime(remainingS: number): string {
  return formatCooldown(Math.ceil(remainingS));
}

/** Segundos restantes de um buff que termina em `endsAtMs` (>= 0). */
export function buffRemainingS(endsAtMs: number, nowMs: number): number {
  return Math.max(0, (endsAtMs - nowMs) / 1000);
}

/** Classe de cor do ping: verde < 120 ms, amarelo < 250 ms, vermelho acima. */
export function pingClass(pingMs: number): "good" | "warn" | "bad" {
  if (pingMs < 120) return "good";
  if (pingMs < 250) return "warn";
  return "bad";
}

/** "120/120" — número atual/máximo de uma barra. */
export function formatBarNumber(current: number, max: number): string {
  return `${Math.max(0, Math.round(current))}/${Math.max(0, Math.round(max))}`;
}

/** Ícone da skill: os 4 ícones reais das assinaturas, resto usa o atlas. */
const SKILL_ICONS: Readonly<Record<string, string>> = {
  espadachim_corte_crescente: "/assets/icon_corte_crescente.png",
  guerreiro_provocacao: "/assets/icon_provocacao.png",
  atirador_disparo_rapido: "/assets/icon_disparo_rapido.png",
  curandeiro_bencao_solar: "/assets/icon_bencao_solar.png",
};
export function skillIconFor(skillId: string): string {
  return SKILL_ICONS[skillId] ?? "/assets/atlas_skills.png";
}

/**
 * Conversão mundo → minimapa (norte para cima). O mundo vai de
 * -sizeM/2 a +sizeM/2 nos dois eixos; o mapa é um quadrado de `px`.
 * Resultado sempre dentro de [0, px].
 */
export function worldToMap(
  x: number,
  y: number,
  sizeM: number,
  px: number,
): { mx: number; my: number } {
  const half = Math.max(1, sizeM / 2);
  const mx = Math.min(px, Math.max(0, (x / half + 1) * 0.5 * px));
  const my = Math.min(px, Math.max(0, (1 - y / half) * 0.5 * px));
  return { mx, my };
}

/** Texto do objetivo de uma quest da Cidade de Serket, em pt-BR. */
export function questObjectiveLabel(q: {
  objective: { type: string; target: string; count: number };
}): string {
  const { type, target, count } = q.objective;
  const mobName = mobById(target)?.name ?? target;
  switch (type) {
    case "kill":
      return count > 1 ? `Derrote ${count} ${mobName}` : `Derrote ${mobName}`;
    case "boss":
      return `Derrote ${mobName}`;
    case "collect":
      return count > 1 ? `Colete ${count}× ${target}` : `Colete ${target}`;
    case "enter":
      return `Entre em ${target}`;
    case "talk":
      return `Fale com ${target}`;
    default:
      return target;
  }
}

/** Máximos de HP/MP/Stamina da classe (+ bônus da armadura equipada). */
export function maxStatsFor(
  classId: string,
  armorId: string | null | undefined,
): { maxHp: number; maxMana: number; maxStamina: number } {
  const cls = classById(classId);
  const armor = armorId ? armorById(armorId) : undefined;
  return {
    maxHp: (cls?.base.maxHp ?? 100) + (armor?.bonus.maxHp ?? 0),
    maxMana: (cls?.base.mana ?? 100) + (armor?.bonus.mana ?? 0),
    maxStamina: cls?.base.stamina ?? 100,
  };
}

/** Jogadores remotos do snapshot → membros da party (sem o jogador local). */
export function partyMembersFromEntities(
  entities: readonly EntityState[],
  localPlayerId: number,
): PartyMember[] {
  const out: PartyMember[] = [];
  for (const e of entities) {
    if (e.kind !== "player" || e.id === localPlayerId) continue;
    out.push({
      id: e.id,
      name: e.name ?? `Jogador #${e.id}`,
      classId: e.classId ?? "espadachim",
      hpPct: e.hpPct,
    });
  }
  return out;
}

/** Mobs do snapshot próximos do jogador → pontos do minimapa. */
export function minimapMobsFromEntities(
  entities: readonly EntityState[],
  playerX: number,
  playerY: number,
  maxDistM = 60,
): MinimapMob[] {
  const out: MinimapMob[] = [];
  for (const e of entities) {
    if (e.kind !== "mob") continue;
    if (Math.hypot(e.x - playerX, e.y - playerY) > maxDistM) continue;
    out.push({ x: e.x, y: e.y });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Tipos públicos                                                     */
/* ------------------------------------------------------------------ */

export type ConnectionState = "connecting" | "waking" | "connected" | "disconnected";

export interface PartyMember {
  id: number;
  name: string;
  classId: string;
  hpPct: number;
}

export interface MinimapMob {
  x: number;
  y: number;
}

/** Estado por frame (chamado a partir de `frame()` em main.ts). */
export interface HudState {
  hpPct: number;
  manaPct: number;
  staminaPct: number;
  /** Mana absoluta atual — decide se o slot fica escurecido sem mana. */
  mana: number;
  playerX: number;
  playerY: number;
  playerYaw: number;
  pingMs: number;
  party: PartyMember[];
  mobs: MinimapMob[];
}

export interface HudBuffInput {
  id: string;
  name: string;
  kind: "buff" | "debuff";
  durationS: number;
}

export type ToastKind = "loot" | "xp" | "level" | "info";

export interface HudOptions {
  playerName: string;
  classId: string;
  armorId?: string | null;
  zoneId?: string;
  /** Chamado quando o jogador dispara uma skill pela hotbar (clique/tecla). */
  onSkill?: (skillId: string) => void;
  onPause?: () => void;
}

/* ------------------------------------------------------------------ */
/* Constantes                                                         */
/* ------------------------------------------------------------------ */

/** Tempo sem conectar antes de avisar que o servidor free está acordando. */
export const WAKING_AFTER_MS = 5000;
/** Toast some após 4 s. */
export const TOAST_MS = 4000;
/** Intervalo mínimo entre redesenhos do minimapa (evita custo por frame). */
const MINIMAP_REDRAW_MS = 150;
/** Assinatura de cada classe é o slot 0; as demais são "Em breve". */
const HOTBAR_KEYS = ["Q", "E", "R", "F"] as const;
const HOTBAR_CODES = ["KeyQ", "KeyE", "KeyR", "KeyF"] as const;

/* ------------------------------------------------------------------ */
/* Helpers de DOM (sem alocação no hot path: elementos criados 1x)    */
/* ------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dispatch(name: string, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/* ------------------------------------------------------------------ */
/* HUD                                                                */
/* ------------------------------------------------------------------ */

interface SlotDom {
  root: HTMLButtonElement;
  icon: HTMLImageElement;
  cdOverlay: HTMLDivElement;
  cdText: HTMLSpanElement;
  manaCost: HTMLSpanElement;
  skill: SkillData;
  signature: boolean;
  /** Último valor de cooldown exibido (décimos) — evita tocar o DOM à toa. */
  lastShownTenths: number;
  lastNoMana: boolean;
}

interface BuffDom {
  id: string;
  name: string;
  kind: "buff" | "debuff";
  endsAtMs: number;
  root: HTMLDivElement;
  timeEl: HTMLSpanElement;
  lastShownS: number;
}

interface ToastDom {
  root: HTMLDivElement;
  timer: number;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly opts: HudOptions;
  private classId: string;
  private armorId: string | null;
  private zoneId: string;
  private zoneName = "Cidade de Serket";
  private zoneSizeM = 100;
  private zoneGround = "#8a7a5f";
  private zoneNpcs: Array<{ name: string; x: number; y: number }> = [];
  private zonePortals: Array<{ label: string; x: number; y: number }> = [];

  private connState: ConnectionState = "connecting";
  private wakingTimer: number | undefined;

  // Barras
  private hpFill!: HTMLDivElement;
  private hpText!: HTMLSpanElement;
  private mpFill!: HTMLDivElement;
  private mpText!: HTMLSpanElement;
  private stFill!: HTMLDivElement;
  private stText!: HTMLSpanElement;
  private lastHpPct = -1;
  private lastMpPct = -1;
  private lastStPct = -1;
  private lastHpText = "";
  private lastMpText = "";
  private lastStText = "";

  // Status / zona / ping
  private connText!: HTMLSpanElement;
  private connBanner!: HTMLDivElement;
  private connBannerText!: HTMLSpanElement;
  private zoneText!: HTMLSpanElement;
  private pingText!: HTMLSpanElement;

  // Hotbar / buffs
  private slots: SlotDom[] = [];
  private cooldownEnds = new Map<string, number>();
  private buffs = new Map<string, BuffDom>();
  private buffsRow!: HTMLDivElement;

  // Minimapa
  private mapCanvas!: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D | null = null;
  private lastMinimapDraw = 0;
  private lastMapState = "";

  // Chat
  private chatLog!: HTMLDivElement;
  private chatInput!: HTMLInputElement;
  private chatTab: "zona" | "party" = "zona";
  private chatMessages: Array<{
    tab: "zona" | "party";
    author: string;
    text: string;
    system: boolean;
  }> = [];
  private chatLocalNoteShown = false;
  private tabZonaBtn!: HTMLButtonElement;
  private tabPartyBtn!: HTMLButtonElement;

  // Party / quests / toasts
  private partyList!: HTMLDivElement;
  private partyEmpty!: HTMLDivElement;
  private lastPartyKey = "";
  private questList!: HTMLDivElement;
  private questBox!: HTMLDivElement;
  private questToggle!: HTMLButtonElement;
  private questProgress = new Map<string, number>();
  private toastsBox!: HTMLDivElement;
  private toasts: ToastDom[] = [];

  private keyHandler = (e: KeyboardEvent): void => this.onKey(e);
  private destroyed = false;

  constructor(root: HTMLElement, opts: HudOptions) {
    this.root = root;
    this.opts = opts;
    this.classId = opts.classId;
    this.armorId = opts.armorId ?? null;
    this.zoneId = opts.zoneId ?? "cidade_serket";
    this.build();
    this.setZone(this.zoneId);
    this.setConnectionState("connecting");
    window.addEventListener("keydown", this.keyHandler);
  }

  /* ------------------------------ build ------------------------------ */

  private build(): void {
    const hud = el("div", "ae-hud");
    hud.id = "ae-hud";
    hud.setAttribute("aria-label", "Interface do jogo");

    /* --- canto superior esquerdo: barras + buffs + botões --- */
    const tl = el("div", "ae-tl");
    const bars = el("div", "ae-bars");
    bars.setAttribute("role", "group");
    bars.setAttribute("aria-label", "Vida, mana e fôlego");
    const mkBar = (label: string, cls: string): { fill: HTMLDivElement; text: HTMLSpanElement } => {
      const row = el("div", `ae-bar-row ${cls}`);
      const name = el("span", "ae-bar-label", label);
      const track = el("div", "ae-bar-track");
      const fill = el("div", "ae-bar-fill");
      const text = el("span", "ae-bar-text", "—/—");
      track.appendChild(fill);
      row.append(name, track, text);
      bars.appendChild(row);
      return { fill, text };
    };
    const hp = mkBar("HP", "ae-hp");
    const mp = mkBar("MP", "ae-mp");
    const st = mkBar("Fôlego", "ae-st");
    this.hpFill = hp.fill;
    this.hpText = hp.text;
    this.mpFill = mp.fill;
    this.mpText = mp.text;
    this.stFill = st.fill;
    this.stText = st.text;

    this.buffsRow = el("div", "ae-buffs");
    this.buffsRow.setAttribute("aria-label", "Efeitos ativos");

    const btnRow = el("div", "ae-btn-row");
    const mkMenuBtn = (label: string, key: string, event: string): HTMLButtonElement => {
      const b = el("button", "ae-menu-btn", `${label} [${key}]`);
      b.type = "button";
      b.addEventListener("click", () => {
        dispatch(event);
        b.blur();
      });
      btnRow.appendChild(b);
      return b;
    };
    mkMenuBtn("Inventário", "I", "ae:open-inventory");
    mkMenuBtn("Skills", "K", "ae:open-skills");
    mkMenuBtn("Mapa", "M", "ae:open-map");
    const pauseBtn = mkMenuBtn("Pausa", "P", "ae:open-pause");
    pauseBtn.addEventListener("click", () => this.opts.onPause?.());
    tl.append(bars, this.buffsRow, btnRow);

    /* --- canto superior direito: zona/ping, minimapa, quests --- */
    const tr = el("div", "ae-tr");
    const status = el("div", "ae-status");
    this.zoneText = el("span", "ae-zone", "—");
    this.pingText = el("span", "ae-ping ae-ping-good", "— ms");
    this.connText = el("span", "ae-conn", "Conectando…");
    status.append(this.zoneText, this.pingText, this.connText);

    const mapWrap = el("div", "ae-map-wrap");
    this.mapCanvas = el("canvas", "ae-minimap");
    this.mapCanvas.width = 296;
    this.mapCanvas.height = 296;
    this.mapCanvas.setAttribute("aria-label", "Minimapa da zona (norte para cima)");
    mapWrap.appendChild(this.mapCanvas);
    this.mapCtx = this.mapCanvas.getContext("2d");

    this.questToggle = el("button", "ae-quest-toggle", "Missões");
    this.questToggle.type = "button";
    this.questToggle.setAttribute("aria-expanded", "false");
    this.questToggle.addEventListener("click", () => {
      const open = this.questBox.classList.toggle("ae-open");
      this.questToggle.setAttribute("aria-expanded", String(open));
      this.questToggle.blur();
    });
    this.questBox = el("div", "ae-quests");
    const questTitle = el("div", "ae-quests-title", "Missões — Cidade de Serket");
    this.questList = el("div", "ae-quest-list");
    this.questBox.append(questTitle, this.questList);
    this.renderQuests();
    tr.append(status, mapWrap, this.questToggle, this.questBox);

    /* --- hotbar inferior central --- */
    const hotbar = el("div", "ae-hotbar");
    hotbar.setAttribute("role", "group");
    hotbar.setAttribute("aria-label", "Habilidades");
    this.buildHotbar(hotbar);

    /* --- chat inferior esquerdo --- */
    const chat = el("div", "ae-chat");
    const tabs = el("div", "ae-chat-tabs");
    this.tabZonaBtn = el("button", "ae-chat-tab ae-active", "Zona");
    this.tabZonaBtn.type = "button";
    this.tabPartyBtn = el("button", "ae-chat-tab", "Party");
    this.tabPartyBtn.type = "button";
    this.tabZonaBtn.addEventListener("click", () => this.setChatTab("zona"));
    this.tabPartyBtn.addEventListener("click", () => this.setChatTab("party"));
    tabs.append(this.tabZonaBtn, this.tabPartyBtn);
    this.chatLog = el("div", "ae-chat-log");
    this.chatLog.setAttribute("aria-live", "polite");
    this.chatInput = el("input", "ae-chat-input");
    this.chatInput.type = "text";
    this.chatInput.maxLength = 200;
    this.chatInput.placeholder = "Falar na Zona… (Enter envia — chat local)";
    this.chatInput.setAttribute("aria-label", "Mensagem do chat");
    this.chatInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") this.sendChat();
      if (e.key === "Escape") this.chatInput.blur();
    });
    chat.append(tabs, this.chatLog, this.chatInput);

    /* --- frame de party (dentro da coluna direita, abaixo das quests) --- */
    const party = el("div", "ae-party");
    party.appendChild(el("div", "ae-party-title", "Party"));
    this.partyEmpty = el("div", "ae-party-empty", "Sozinho na zona — outros jogadores aparecem aqui.");
    this.partyList = el("div", "ae-party-list");
    party.append(this.partyEmpty, this.partyList);
    tr.appendChild(party);

    /* --- toasts acima da hotbar --- */
    this.toastsBox = el("div", "ae-toasts");
    this.toastsBox.setAttribute("aria-live", "polite");

    /* --- banner de conexão (centro-topo, só quando não conectado) --- */
    this.connBanner = el("div", "ae-conn-banner");
    this.connBannerText = el("span", "ae-conn-banner-text", "Conectando…");
    const reloadBtn = el("button", "ae-reload-btn", "Recarregar");
    reloadBtn.type = "button";
    reloadBtn.addEventListener("click", () => window.location.reload());
    this.connBanner.append(this.connBannerText, reloadBtn);
    reloadBtn.style.display = "none";

    hud.append(tl, tr, hotbar, chat, this.toastsBox, this.connBanner);
    this.root.appendChild(hud);
    this.addSystemMessage("Bem-vindo a Azure Edge! O chat é local por enquanto — o servidor ainda não tem chat.");
  }

  private buildHotbar(hotbar: HTMLDivElement): void {
    const cls = classById(this.classId);
    const skills = SKILLS.filter((s) => s.classId === this.classId);
    const signatureId = cls?.skillId ?? skills[0]?.id ?? "";
    skills.sort((a, b) => (a.id === signatureId ? -1 : b.id === signatureId ? 1 : 0));
    this.slots = [];
    skills.slice(0, 4).forEach((skill, i) => {
      const signature = skill.id === signatureId;
      const root = el("button", "ae-slot") as HTMLButtonElement;
      root.type = "button";
      const key = HOTBAR_KEYS[i] ?? String(i + 1);
      root.setAttribute(
        "aria-label",
        `${skill.name} [${key}] — custo ${skill.costMana} de mana, recarga ${skill.cooldownS} s${signature ? "" : " (em breve)"}`,
      );
      root.title = signature
        ? `${skill.name} — ${skill.description ?? ""}\nCusto: ${skill.costMana} mana · Recarga: ${skill.cooldownS} s`
        : `${skill.name} — ${skill.description ?? ""}\nCusto: ${skill.costMana} mana · Recarga: ${skill.cooldownS} s\n(Em breve — o servidor ainda só executa a skill assinatura)`;
      const icon = el("img", "ae-slot-icon") as HTMLImageElement;
      icon.src = skillIconFor(skill.id);
      icon.alt = skill.name;
      icon.draggable = false;
      const cdOverlay = el("div", "ae-slot-cd");
      const cdText = el("span", "ae-slot-cd-text", "");
      const manaCost = el("span", "ae-slot-mana", `${skill.costMana}`);
      manaCost.title = "Custo de mana";
      const keyEl = el("span", "ae-slot-key", key);
      const nameEl = el("span", "ae-slot-name", skill.name);
      if (!signature) {
        const soon = el("span", "ae-slot-soon", "Em breve");
        root.appendChild(soon);
      }
      root.append(icon, cdOverlay, cdText, manaCost, keyEl, nameEl);
      root.addEventListener("click", () => {
        this.useSkill(skill.id);
        root.blur();
      });
      hotbar.appendChild(root);
      this.slots.push({
        root,
        icon,
        cdOverlay,
        cdText,
        manaCost,
        skill: skill,
        signature,
        lastShownTenths: -1,
        lastNoMana: false,
      });
    });
  }

  private renderQuests(): void {
    this.questList.textContent = "";
    for (const q of CITY.quests.slice(0, 3)) {
      const row = el("div", "ae-quest");
      const name = el("div", "ae-quest-name", `${q.name} · nv ${q.level}`);
      const obj = el("div", "ae-quest-obj", questObjectiveLabel(q));
      const prog = el("div", "ae-quest-prog", this.questProgressText(q.id, q.objective.count));
      prog.dataset.questId = q.id;
      row.append(name, obj, prog);
      this.questList.appendChild(row);
    }
    const note = el("div", "ae-quest-note", "Progresso local — o servidor ainda não valida quests.");
    this.questList.appendChild(note);
  }

  private questProgressText(questId: string, total: number): string {
    const done = this.questProgress.get(questId) ?? 0;
    return `${Math.min(done, total)}/${total}`;
  }

  /* --------------------------- API pública --------------------------- */

  /** Estado de conexão. "connecting" vira "waking" sozinho após 5 s. */
  setConnectionState(state: ConnectionState): void {
    this.connState = state;
    if (this.wakingTimer !== undefined) {
      window.clearTimeout(this.wakingTimer);
      this.wakingTimer = undefined;
    }
    const reloadBtn = this.connBanner.querySelector<HTMLButtonElement>(".ae-reload-btn");
    if (state === "connected") {
      this.connText.textContent = "Conectado";
      this.connBanner.classList.remove("ae-show");
      return;
    }
    if (state === "disconnected") {
      this.connText.textContent = "Desconectado";
      this.connBannerText.textContent = "Desconectado — recarregue a página.";
      if (reloadBtn) reloadBtn.style.display = "";
      this.connBanner.classList.add("ae-show");
      return;
    }
    if (state === "waking") {
      this.connText.textContent = "Acordando o servidor…";
      this.connBannerText.textContent = "Acordando o servidor… (plano free, pode levar ~1 min)";
      if (reloadBtn) reloadBtn.style.display = "none";
      this.connBanner.classList.add("ae-show");
      return;
    }
    // connecting
    this.connText.textContent = "Conectando…";
    this.connBannerText.textContent = "Conectando ao servidor…";
    if (reloadBtn) reloadBtn.style.display = "none";
    this.connBanner.classList.add("ae-show");
    this.wakingTimer = window.setTimeout(() => {
      if (!this.destroyed && this.connState === "connecting") {
        this.setConnectionState("waking");
      }
    }, WAKING_AFTER_MS);
  }

  /** Troca a zona (nome, minimapa, e o tracker só aparece na cidade). */
  setZone(zoneId: string): void {
    this.zoneId = zoneId;
    const zone = zoneById(zoneId);
    const dungeon = !zone ? dungeonById(zoneId) : undefined;
    if (zone) {
      this.zoneName = zone.zone.subArea ? `${zone.zone.name} — ${zone.zone.subArea}` : zone.zone.name;
      this.zoneSizeM = zone.zone.sizeM;
      this.zoneGround = zone.palette.ground;
      this.zoneNpcs = zone.npcs ?? [];
      this.zonePortals = zone.portals ?? [];
    } else if (dungeon) {
      this.zoneName = `${dungeon.name} (nv ${dungeon.levelMin}–${dungeon.levelMax})`;
      this.zoneSizeM = 100;
      this.zoneGround = "#3a2f1d";
      this.zoneNpcs = [];
      this.zonePortals = [];
    } else {
      this.zoneName = zoneId;
      this.zoneSizeM = 100;
      this.zoneGround = "#8a7a5f";
      this.zoneNpcs = [];
      this.zonePortals = [];
    }
    this.zoneText.textContent = this.zoneName;
    // Tracker de quests é da Cidade de Serket; fora dela ele some.
    const inCity = zoneId === "cidade_serket";
    this.questBox.style.display = inCity ? "" : "none";
    this.questToggle.style.display = inCity ? "" : "none";
    this.lastMapState = "";
    this.lastMinimapDraw = 0;
  }

  /** Troca de classe/armadura (ex.: reabrir o criador): rebuild da hotbar. */
  setClass(classId: string, armorId?: string | null): void {
    this.classId = classId;
    if (armorId !== undefined) this.armorId = armorId;
    const hotbar = this.root.querySelector<HTMLDivElement>(".ae-hotbar");
    if (hotbar) {
      hotbar.textContent = "";
      this.cooldownEnds.clear();
      this.buildHotbar(hotbar);
    }
  }

  /**
   * Dispara uma skill pela hotbar. A assinatura dispara `ae:use-skill` (e
   * `opts.onSkill`); as demais só avisam que ainda não estão no servidor.
   * O cooldown local começa em `startSkillCooldown` (chamado por main.ts
   * quando o input é enviado) — aqui só validamos o clique.
   */
  useSkill(skillId: string): void {
    const slot = this.slots.find((s) => s.skill.id === skillId);
    if (!slot) return;
    if (!slot.signature) {
      this.toast(`${slot.skill.name} ainda não está no servidor (M3).`, "info");
      return;
    }
    if (this.skillRemainingS(skillId) > 0) return;
    dispatch("ae:use-skill", { skillId });
    this.opts.onSkill?.(skillId);
  }

  /** Inicia o cooldown local de uma skill (a partir do gamedata). */
  startSkillCooldown(skillId: string, nowMs = performance.now()): void {
    const skill = this.slots.find((s) => s.skill.id === skillId)?.skill;
    if (!skill) return;
    this.cooldownEnds.set(skillId, nowMs + skill.cooldownS * 1000);
    if (skill.buff) this.addBuff({ id: skill.id, name: skill.name, kind: "buff", durationS: skill.buff.durationS }, nowMs);
    if (skill.taunt) this.addBuff({ id: skill.id, name: skill.name, kind: "buff", durationS: skill.taunt.durationS }, nowMs);
  }

  /** Cancela o cooldown local (ex.: `onReject` do servidor). */
  clearSkillCooldown(skillId: string): void {
    this.cooldownEnds.delete(skillId);
    const slot = this.slots.find((s) => s.skill.id === skillId);
    if (slot) {
      slot.lastShownTenths = -1;
      slot.cdOverlay.style.background = "";
      slot.cdText.textContent = "";
    }
  }

  /** Segundos restantes do cooldown local (0 = pronta). */
  skillRemainingS(skillId: string, nowMs = performance.now()): number {
    const ends = this.cooldownEnds.get(skillId);
    return ends === undefined ? 0 : Math.max(0, (ends - nowMs) / 1000);
  }

  /** Adiciona/atualiza um buff ou debuff com tempo restante. */
  addBuff(buff: HudBuffInput, nowMs = performance.now()): void {
    const existing = this.buffs.get(buff.id);
    if (existing) {
      existing.endsAtMs = nowMs + buff.durationS * 1000;
      existing.lastShownS = -1;
      return;
    }
    const root = el("div", `ae-buff ae-${buff.kind}`);
    const name = el("span", "ae-buff-name", buff.name);
    const timeEl = el("span", "ae-buff-time", formatBuffTime(buff.durationS));
    root.append(name, timeEl);
    this.buffsRow.appendChild(root);
    this.buffs.set(buff.id, {
      id: buff.id,
      name: buff.name,
      kind: buff.kind,
      endsAtMs: nowMs + buff.durationS * 1000,
      root,
      timeEl,
      lastShownS: Math.ceil(buff.durationS),
    });
  }

  removeBuff(id: string): void {
    const b = this.buffs.get(id);
    if (!b) return;
    b.root.remove();
    this.buffs.delete(id);
  }

  /**
   * Conta um abate para as quests ativas (chamar com o mobId do gamedata,
   * ex.: "formiga" — main.ts mapeia o targetId do evento via lastSnapshot).
   */
  noteKill(mobId: string): void {
    for (const q of CITY.quests.slice(0, 3)) {
      if (q.objective.target !== mobId) continue;
      if (q.objective.type !== "kill" && q.objective.type !== "boss") continue;
      const cur = this.questProgress.get(q.id) ?? 0;
      if (cur >= q.objective.count) continue;
      this.questProgress.set(q.id, cur + 1);
      this.refreshQuestProgress();
      if (cur + 1 >= q.objective.count) {
        this.toast(`Missão concluída (local): ${q.name} — recompensa de ${q.rewards.xp} XP vale no servidor em breve.`, "xp");
      }
    }
  }

  /** Progresso manual de quest (ex.: coletas futuras vindas do servidor). */
  setQuestProgress(questId: string, count: number): void {
    this.questProgress.set(questId, Math.max(0, count));
    this.refreshQuestProgress();
  }

  private refreshQuestProgress(): void {
    for (const q of CITY.quests.slice(0, 3)) {
      const progEl = this.questList.querySelector<HTMLDivElement>(`[data-quest-id="${q.id}"]`);
      if (progEl) progEl.textContent = this.questProgressText(q.id, q.objective.count);
    }
  }

  /** Toast na fila (máx. 3 visíveis, some após 4 s). */
  toast(text: string, kind: ToastKind = "info"): void {
    while (this.toasts.length >= 3) {
      const old = this.toasts.shift();
      if (old) {
        window.clearTimeout(old.timer);
        old.root.remove();
      }
    }
    const root = el("div", `ae-toast ae-toast-${kind}`, text);
    this.toastsBox.appendChild(root);
    const timer = window.setTimeout(() => {
      root.remove();
      const idx = this.toasts.findIndex((t) => t.root === root);
      if (idx >= 0) this.toasts.splice(idx, 1);
    }, TOAST_MS);
    this.toasts.push({ root, timer });
  }

  /** Efeito LOCAL de consumível (poção): flash de cura na barra de HP + toast.
   *  Não toca o servidor — o HP autoritativo continua vindo do snapshot. */
  showLocalRestore(kind: "hp" | "mana", amount: number): void {
    if (kind === "hp") {
      this.flashBar(this.hpFill, "ae-flash-heal");
      this.toast(`+${amount} de HP (local — o servidor ainda não aplica consumíveis)`, "info");
    } else {
      this.toast(`+${amount} de mana (local — o servidor ainda não aplica consumíveis)`, "info");
    }
  }

  /** Mensagem de sistema no chat (aba Zona, salvo no histórico). */
  addSystemMessage(text: string): void {
    this.pushChat("zona", "Sistema", text, true);
  }

  /** Mensagem de chat de outro jogador (aba indicada). */
  addChatMessage(author: string, text: string, tab: "zona" | "party" = "zona"): void {
    this.pushChat(tab, author, text, false);
  }

  private setChatTab(tab: "zona" | "party"): void {
    this.chatTab = tab;
    this.tabZonaBtn.classList.toggle("ae-active", tab === "zona");
    this.tabPartyBtn.classList.toggle("ae-active", tab === "party");
    this.chatInput.placeholder =
      tab === "zona"
        ? "Falar na Zona… (Enter envia — chat local)"
        : "Falar na Party… (Enter envia — chat local)";
    this.renderChatLog();
  }

  private pushChat(tab: "zona" | "party", author: string, text: string, system: boolean): void {
    this.chatMessages.push({ tab, author, text, system });
    if (this.chatMessages.length > 50) this.chatMessages.splice(0, this.chatMessages.length - 50);
    this.renderChatLog();
  }

  private renderChatLog(): void {
    // Rebuild só do log visível; 50 msgs no máx., fora do hot path de frames.
    const visible = this.chatMessages.filter((m) => m.tab === this.chatTab || m.system);
    this.chatLog.textContent = "";
    for (const m of visible.slice(-30)) {
      const line = el("div", m.system ? "ae-chat-line ae-system" : "ae-chat-line");
      const who = el("span", "ae-chat-author", m.system ? "" : `${m.author}: `);
      const body = el("span", "ae-chat-text", m.text);
      line.append(who, body);
      this.chatLog.appendChild(line);
    }
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  private sendChat(): void {
    const text = this.chatInput.value.trim();
    if (!text) return;
    this.chatInput.value = "";
    this.pushChat(this.chatTab, this.opts.playerName || "Você", text, false);
    dispatch("ae:chat-send", { tab: this.chatTab, text });
    if (!this.chatLocalNoteShown) {
      this.chatLocalNoteShown = true;
      this.addSystemMessage("Chat local — sua mensagem só aparece para você até o servidor ter chat.");
    }
  }

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    if (e.repeat) return;
    const idx = HOTBAR_CODES.indexOf(e.code as (typeof HOTBAR_CODES)[number]);
    if (idx >= 0) {
      const slot = this.slots[idx];
      if (slot && slot.signature) {
        // Q já é tratado por main.ts (pendingSkill); não disparar 2x.
        if (e.code !== "KeyQ") this.useSkill(slot.skill.id);
      } else if (slot) {
        this.useSkill(slot.skill.id);
      }
      return;
    }
    // I/K/M são do GameScreens (teclas remapeáveis): o HUD não dispara
    // aqui, senão o menu abriria e fecharia no mesmo keydown (duplo toggle).
    if (e.code === "KeyP") {
      dispatch("ae:open-pause");
      this.opts.onPause?.();
    }
  }

  /* ------------------------- update por frame ------------------------ */

  /**
   * Chamado a cada frame por main.ts. Não aloca no hot path: só toca o DOM
   * quando o valor exibido realmente mudou (arredondado), e o minimapa é
   * redesenhado no máximo a cada 150 ms.
   */
  update(state: HudState, nowMs = performance.now()): void {
    // --- barras (flash de dano/cura ao variar o HP) ---
    if (state.hpPct !== this.lastHpPct) {
      if (this.lastHpPct >= 0 && state.hpPct < this.lastHpPct) this.flashBar(this.hpFill, "ae-flash-damage");
      if (this.lastHpPct >= 0 && state.hpPct > this.lastHpPct) this.flashBar(this.hpFill, "ae-flash-heal");
      this.lastHpPct = state.hpPct;
      this.hpFill.style.width = `${clamp01(state.hpPct / 100) * 100}%`;
    }
    if (state.manaPct !== this.lastMpPct) {
      this.lastMpPct = state.manaPct;
      this.mpFill.style.width = `${clamp01(state.manaPct / 100) * 100}%`;
    }
    if (state.staminaPct !== this.lastStPct) {
      this.lastStPct = state.staminaPct;
      this.stFill.style.width = `${clamp01(state.staminaPct / 100) * 100}%`;
    }
    const max = maxStatsFor(this.classId, this.armorId);
    const hpText = formatBarNumber((state.hpPct / 100) * max.maxHp, max.maxHp);
    const mpText = formatBarNumber((state.manaPct / 100) * max.maxMana, max.maxMana);
    const stText = formatBarNumber((state.staminaPct / 100) * max.maxStamina, max.maxStamina);
    if (hpText !== this.lastHpText) {
      this.lastHpText = hpText;
      this.hpText.textContent = hpText;
    }
    if (mpText !== this.lastMpText) {
      this.lastMpText = mpText;
      this.mpText.textContent = mpText;
    }
    if (stText !== this.lastStText) {
      this.lastStText = stText;
      this.stText.textContent = stText;
    }

    // --- ping ---
    const pingText = `${Math.round(state.pingMs)} ms`;
    if (this.pingText.textContent !== pingText) this.pingText.textContent = pingText;
    const pc = pingClass(state.pingMs);
    const pingCls = `ae-ping ae-ping-${pc}`;
    if (this.pingText.className !== pingCls) this.pingText.className = pingCls;

    // --- cooldowns da hotbar (overlay conic + texto, décimos) ---
    for (const slot of this.slots) {
      const remaining = this.skillRemainingS(slot.skill.id, nowMs);
      const tenths = remaining > 0 ? Math.ceil(remaining * 10) : 0;
      const noMana = state.mana < slot.skill.costMana;
      if (tenths !== slot.lastShownTenths) {
        slot.lastShownTenths = tenths;
        if (tenths > 0) {
          const frac = clamp01(remaining / slot.skill.cooldownS);
          slot.cdOverlay.style.background = `conic-gradient(rgba(5,20,30,0.78) ${frac * 360}deg, transparent 0deg)`;
          slot.cdText.textContent = formatCooldown(tenths / 10);
        } else {
          slot.cdOverlay.style.background = "";
          slot.cdText.textContent = "";
        }
      }
      if (noMana !== slot.lastNoMana) {
        slot.lastNoMana = noMana;
        slot.root.classList.toggle("ae-no-mana", noMana);
      }
    }

    // --- buffs (texto só quando o segundo muda; expirado some) ---
    for (const [id, b] of [...this.buffs.entries()]) {
      const left = buffRemainingS(b.endsAtMs, nowMs);
      if (left <= 0) {
        this.removeBuff(id);
        continue;
      }
      const shown = Math.ceil(left);
      if (shown !== b.lastShownS) {
        b.lastShownS = shown;
        b.timeEl.textContent = formatBuffTime(left);
      }
    }

    // --- party (rebuild só quando muda id/HP arredondado) ---
    const partyKey = state.party
      .map((p) => `${p.id}:${p.name}:${p.classId}:${Math.round(p.hpPct)}`)
      .join("|");
    if (partyKey !== this.lastPartyKey) {
      this.lastPartyKey = partyKey;
      this.renderParty(state.party);
    }

    // --- minimapa (throttle 150 ms) ---
    if (nowMs - this.lastMinimapDraw >= MINIMAP_REDRAW_MS) {
      this.lastMinimapDraw = nowMs;
      this.drawMinimap(state);
    }
  }

  private flashBar(fill: HTMLDivElement, cls: string): void {
    fill.classList.remove(cls);
    void fill.offsetWidth; // reinicia a animação
    fill.classList.add(cls);
  }

  private renderParty(party: PartyMember[]): void {
    this.partyList.textContent = "";
    this.partyEmpty.style.display = party.length === 0 ? "" : "none";
    for (const p of party.slice(0, 7)) {
      const row = el("div", "ae-party-row");
      const clsName = classById(p.classId)?.name ?? p.classId;
      const name = el("span", "ae-party-name", `${p.name} · ${clsName}`);
      const track = el("div", "ae-party-hp");
      const fill = el("div", "ae-party-hp-fill");
      fill.style.width = `${clamp01(p.hpPct / 100) * 100}%`;
      track.appendChild(fill);
      const pct = el("span", "ae-party-pct", `${Math.round(p.hpPct)}%`);
      row.append(name, track, pct);
      this.partyList.appendChild(row);
    }
  }

  private drawMinimap(state: HudState): void {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const px = this.mapCanvas.width; // 296 (backing 2x do CSS 148)
    const key = `${this.zoneId}|${Math.round(state.playerX * 2)}|${Math.round(state.playerY * 2)}|${state.mobs.length}`;
    if (key === this.lastMapState) return;
    this.lastMapState = key;

    ctx.clearRect(0, 0, px, px);
    // Fundo da zona + borda (muralha/limite).
    ctx.fillStyle = this.zoneGround;
    ctx.fillRect(0, 0, px, px);
    ctx.strokeStyle = "rgba(212,160,23,0.9)";
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, px - 4, px - 4);

    // Portais (círculos ciano) e NPCs (losangos dourados).
    for (const p of this.zonePortals) {
      const { mx, my } = worldToMap(p.x, p.y, this.zoneSizeM, px);
      ctx.fillStyle = "#7cc4ff";
      ctx.beginPath();
      ctx.arc(mx, my, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#0b1620";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    for (const n of this.zoneNpcs) {
      const { mx, my } = worldToMap(n.x, n.y, this.zoneSizeM, px);
      ctx.fillStyle = "#d4a017";
      ctx.beginPath();
      ctx.moveTo(mx, my - 8);
      ctx.lineTo(mx + 8, my);
      ctx.lineTo(mx, my + 8);
      ctx.lineTo(mx - 8, my);
      ctx.closePath();
      ctx.fill();
    }
    // Mobs próximos (pontos carmesim).
    ctx.fillStyle = "#c0392b";
    for (const m of state.mobs) {
      const { mx, my } = worldToMap(m.x, m.y, this.zoneSizeM, px);
      ctx.beginPath();
      ctx.arc(mx, my, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Jogador: seta dourada girada pelo yaw (norte para cima).
    const { mx, my } = worldToMap(state.playerX, state.playerY, this.zoneSizeM, px);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(state.playerYaw);
    ctx.fillStyle = "#ffe9b8";
    ctx.strokeStyle = "#0b1620";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener("keydown", this.keyHandler);
    if (this.wakingTimer !== undefined) window.clearTimeout(this.wakingTimer);
    for (const t of this.toasts) window.clearTimeout(t.timer);
    this.root.querySelector("#ae-hud")?.remove();
  }
}

/** Atalho: `createHud(document.body, {...})`. */
export function createHud(root: HTMLElement, opts: HudOptions): Hud {
  return new Hud(root, opts);
}
