import {
  ARMORS,
  CITY,
  CLASSES,
  DUNGEONS,
  ZONE,
  armorsForClass,
  classById,
  skillById,
  zoneById,
  type ZoneData,
} from "@azure-edge/gamedata";
import { loadSavedGenome } from "./creator.js";
import {
  INVENTORY_CAPACITY,
  ITEM_FILTERS,
  ITEM_SORTS,
  RARITY_COLORS,
  RARITY_LABELS,
  SLOT_LABELS,
  SLOT_ORDER,
  bagItems,
  buildItemCatalog,
  canEquip,
  catalogById,
  discardItem,
  equipItem,
  formatGold,
  isEquipped,
  loadInventoryState,
  saveInventoryState,
  sellItem,
  totalWeight,
  unequipSlot,
  useConsumable,
  type EquipSlot,
  type InventoryItem,
  type InventoryState,
  type ItemFilter,
  type ItemSort,
} from "./inventory.js";
import {
  loadProgress,
  nodeStateLabel,
  skillEffectLines,
  skillKindLabel,
  skillTreeNodes,
  xpFraction,
  xpToNextLevel,
  type TreeNodeView,
} from "./skilltree.js";
import "./screens.css";

/**
 * Telas e menus do Azure Edge (HTML/CSS/TS sobre o canvas).
 *
 * Comunicação com o jogo:
 * - OUVE (CustomEvents no window, disparados pelo HUD / main.ts):
 *   `ae:open-inventory`, `ae:open-skills`, `ae:open-map`, `ae:open-pause`,
 *   `ae:show-death` (detail: { respawnSeconds?: number }),
 *   `ae:hide-death`.
 * - EMITE: `ae:equip-armor` (detail: { armorId }), `ae:respawn`,
 *   `ae:settings-changed` (detail: Settings).
 * - CALLBACKS (opções do construtor, ligados por main.ts): onPlay,
 *   onContinue, onEquipArmor, onQuality, onRespawn, onReturnToStart,
 *   onToggleHud + getters (getClassId, getZoneId, getPlayerPosition,
 *   getEquippedArmorId). Nada aqui depende de main.ts já estar ligado:
 *   sem callbacks, tudo degrada para comportamento local documentado.
 *
 * Escopo honesto: inventário/skills/mapa/settings são locais e visuais.
 * Equipar armadura aplica o visual (view.setArmor via onEquipArmor); o
 * bônus de HP do servidor só vale no próximo login (join-time). Skills
 * fora da assinatura Q estão marcadas "Em breve" e não executam nada.
 * Menus NÃO pausam o servidor: o mundo continua rodando.
 */

// ---------------------------------------------------------------------------
// Lógica pura (testada em screens.test.ts)
// ---------------------------------------------------------------------------

export interface NameValidation {
  valid: boolean;
  error: string | null;
}

const NAME_PATTERN = /^[\p{L}\p{N} _-]+$/u;

/** Nome do personagem: 3–16 caracteres após trim; letras (com acento), números, espaço, _ e -. */
export function validateCharacterName(raw: string): NameValidation {
  const name = raw.trim();
  if (name.length < 3) return { valid: false, error: "O nome precisa ter pelo menos 3 caracteres." };
  if (name.length > 16) return { valid: false, error: "O nome pode ter no máximo 16 caracteres." };
  if (!NAME_PATTERN.test(name)) {
    return { valid: false, error: "Use apenas letras, números, espaços, _ ou -." };
  }
  if (/\s{2,}/.test(name)) return { valid: false, error: "O nome não pode ter dois espaços seguidos." };
  return { valid: true, error: null };
}

export type KeyAction =
  | "inventory"
  | "skills"
  | "map"
  | "pause"
  | "dodge"
  | "signatureSkill";

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  inventory: "Inventário",
  skills: "Skills",
  map: "Mapa",
  pause: "Pausa",
  dodge: "Esquiva",
  signatureSkill: "Skill assinatura (Q)",
};

export type KeyBindings = Record<KeyAction, string>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  inventory: "KeyI",
  skills: "KeyK",
  map: "KeyM",
  pause: "Escape",
  dodge: "Space",
  signatureSkill: "KeyQ",
};

export const KEY_BINDINGS_STORAGE_KEY = "azure-edge:keybindings:v1";

/** Nome legível de um KeyboardEvent.code ("KeyI" → "I", "Escape" → "Esc"). */
export function prettyKey(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Escape") return "Esc";
  if (code === "Space") return "Espaço";
  return code;
}

export function loadKeyBindings(): KeyBindings {
  try {
    const raw = localStorage.getItem(KEY_BINDINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_KEY_BINDINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_KEY_BINDINGS };
    const out: KeyBindings = { ...DEFAULT_KEY_BINDINGS };
    for (const action of Object.keys(DEFAULT_KEY_BINDINGS) as KeyAction[]) {
      const v = (parsed as Record<string, unknown>)[action];
      if (typeof v === "string" && v.length > 0) out[action] = v;
    }
    return out;
  } catch {
    return { ...DEFAULT_KEY_BINDINGS };
  }
}

export function saveKeyBindings(bindings: KeyBindings): void {
  localStorage.setItem(KEY_BINDINGS_STORAGE_KEY, JSON.stringify(bindings));
}

export interface RebindResult {
  bindings: KeyBindings;
  /** Ação que já usava a tecla, se houver (conflito: remapeamento recusado). */
  conflict: KeyAction | null;
}

/** Remapeia uma ação; recusa se a tecla já estiver em uso por outra ação. */
export function rebindKey(bindings: KeyBindings, action: KeyAction, code: string): RebindResult {
  const conflict = (Object.keys(bindings) as KeyAction[]).find(
    (a) => a !== action && bindings[a] === code,
  );
  if (conflict) return { bindings, conflict };
  return { bindings: { ...bindings, [action]: code }, conflict: null };
}

/** Ação (se houver) ligada a um KeyboardEvent.code. */
export function actionForCode(bindings: KeyBindings, code: string): KeyAction | null {
  const found = (Object.keys(bindings) as KeyAction[]).find((a) => bindings[a] === code);
  return found ?? null;
}

export type Quality = "low" | "med" | "high";

export const QUALITY_LABELS: Record<Quality, string> = {
  low: "Baixa",
  med: "Média",
  high: "Alta",
};

export interface Settings {
  quality: Quality;
  volume: number; // 0–100
  zoomSensitivity: number; // 0.5–2
  showHud: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: "med",
  volume: 80,
  zoomSensitivity: 1,
  showHud: true,
};

export const SETTINGS_STORAGE_KEY = "azure-edge:settings:v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_SETTINGS };
    const p = parsed as Partial<Settings>;
    return {
      quality: p.quality === "low" || p.quality === "med" || p.quality === "high" ? p.quality : "med",
      volume: typeof p.volume === "number" ? Math.min(100, Math.max(0, p.volume)) : 80,
      zoomSensitivity:
        typeof p.zoomSensitivity === "number" ? Math.min(2, Math.max(0.5, p.zoomSensitivity)) : 1,
      showHud: typeof p.showHud === "boolean" ? p.showHud : true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

// --- Loading real (pesos por etapa; nada de progresso falso) ---

export interface LoadingStage {
  id: string;
  label: string;
  /** Peso da etapa no total (soma = 1). */
  weight: number;
}

export const LOADING_STAGES: LoadingStage[] = [
  { id: "connect", label: "Conectando ao servidor…", weight: 0.2 },
  { id: "glb", label: "Baixando personagem…", weight: 0.6 },
  { id: "zone", label: "Entrando na zona…", weight: 0.2 },
];

/** Fração total (0–1) dada a etapa atual e o progresso dentro dela (0–1). */
export function loadingFractionFor(stageIndex: number, stageFraction: number): number {
  const clampedStage = Math.min(LOADING_STAGES.length - 1, Math.max(0, stageIndex));
  const clampedFrac = Math.min(1, Math.max(0, stageFraction));
  let total = 0;
  for (let i = 0; i < clampedStage; i++) total += LOADING_STAGES[i]?.weight ?? 0;
  total += (LOADING_STAGES[clampedStage]?.weight ?? 0) * clampedFrac;
  return Math.min(1, Math.max(0, total));
}

/** Formata bytes baixados: "12,4 MB de 25,0 MB". */
export function formatBytesProgress(loaded: number, total: number): string {
  const mb = (n: number): string => (n / (1024 * 1024)).toFixed(1).replace(".", ",");
  if (total > 0) return `${mb(loaded)} MB de ${mb(total)} MB`;
  return `${mb(loaded)} MB baixados`;
}

export const LOADING_TIPS: readonly string[] = [
  "WASD move · clique esquerdo ataca · Espaço esquiva.",
  "Esquiva perfeita: esquive no instante do golpe inimigo para ganhar tempo lento.",
  "Segure o botão direito para guardar — bloqueia 70% do dano pela frente.",
  "Q usa a skill assinatura da sua classe. Acerte o parry nos 8 primeiros frames da guarda.",
  "Aperte T para trocar o conjunto de armadura (visual).",
  "I abre o inventário, K as skills, M o mapa e Esc pausa o jogo.",
  "Na Cidade de Serket, fale com a Sacerdotisa Nara para se curar.",
  "Múmias aparecem nas Tumbas Soterradas (nv 5–12). Leve poções.",
  "O boss Serket espera no Templo de Serket (nv 13–20). Não vá sozinho.",
  "Dano crítico aparece em dourado. Acerte o 4º golpe da cadeia para o finalizador.",
];

/** Próximo índice de dica (cíclico). */
export function nextTipIndex(current: number): number {
  return (current + 1) % LOADING_TIPS.length;
}

/** "5 s" / "0 s" para o contador de respawn. */
export function formatCountdown(seconds: number): string {
  return `${Math.max(0, Math.ceil(seconds))} s`;
}

/** Há genome salvo em localStorage (para o botão Continuar)? */
export function hasSavedGenome(): boolean {
  return loadSavedGenome() !== null;
}

/**
 * fetch com progresso REAL de bytes. Resolve com o ArrayBuffer.
 * Sem Content-Length, onProgress recebe (loaded, 0) — sem % inventado.
 */
export async function fetchWithProgress(
  url: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar ${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get("Content-Length") ?? 0) || 0;
  if (!res.body) {
    const buf = await res.arrayBuffer();
    onProgress(buf.byteLength, total);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total);
    }
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

/** Ícones reais das skills assinatura (assets aprovados em public/assets). */
export const SKILL_ICONS: Record<string, string> = {
  espadachim_corte_crescente: "/assets/icon_corte_crescente.png",
  guerreiro_provocacao: "/assets/icon_provocacao.png",
  atirador_disparo_rapido: "/assets/icon_disparo_rapido.png",
  curandeiro_bencao_solar: "/assets/icon_bencao_solar.png",
};

export const GLB_FEMALE_URL = "/assets/characters/warrior_f_r64_final.glb";
export const GLB_MALE_URL = "/assets/characters/warrior_m_klein_r64_final_rigged.glb";
export const LOADING_ART_URL = "/assets/loading_serket.jpg";

// ---------------------------------------------------------------------------
// Telas
// ---------------------------------------------------------------------------

export type MenuKind = "inventory" | "skills" | "map" | "settings";
export type StartChoice = "play" | "continue";

export interface ScreensOptions {
  version?: string;
  serverLabel?: string;
  getClassId?: () => string | null;
  getZoneId?: () => string | null;
  getPlayerPosition?: () => { x: number; y: number } | null;
  getEquippedArmorId?: () => string | null;
  onPlay?: () => void;
  onContinue?: () => void;
  onEquipArmor?: (armorId: string | null) => void;
  onQuality?: (quality: Quality) => void;
  onRespawn?: () => void;
  onReturnToStart?: () => void;
  onToggleHud?: (visible: boolean) => void;
}

interface MenuHandle {
  kind: MenuKind;
  el: HTMLElement;
}

const MENU_TITLES: Record<MenuKind, string> = {
  inventory: "Inventário",
  skills: "Skills",
  map: "Mapa",
  settings: "Configurações",
};

export class GameScreens {
  private readonly opts: ScreensOptions;
  private readonly root: HTMLElement;
  private bindings: KeyBindings = loadKeyBindings();
  private settings: Settings = loadSettings();
  private openMenus: MenuHandle[] = [];
  private pauseEl: HTMLElement | null = null;
  private deathEl: HTMLElement | null = null;
  private deathTimer: number | null = null;
  private deathResolved = false;
  private loadingStage = 0;
  private loadingEl: HTMLElement | null = null;
  private tipIndex = 0;
  private tipTimer: number | null = null;
  private mapZoneId: string | null = null;
  private mapRaf = 0;
  private mapCanvas: HTMLCanvasElement | null = null;
  private capturingAction: KeyAction | null = null;
  private startResolve: ((c: StartChoice) => void) | null = null;
  // Janelas de skills / inventário (estado local, persiste em localStorage).
  private invState: InventoryState | null = null;
  private invFilter: ItemFilter = "all";
  private invSort: ItemSort = "rarity";
  private invSelected: string | null = null;
  private invConfirmDiscard: string | null = null;
  private invMsgText = "";
  /** Tooltip travado após clicar num item: só volta quando o mouse sai da bolsa/boneco. */
  private invTooltipLocked = false;
  private skillSelected: string | null = null;

  constructor(options: ScreensOptions = {}) {
    this.opts = options;
    let root = document.getElementById("screens-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "screens-root";
      document.body.appendChild(root);
    }
    this.root = root;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("ae:open-inventory", () => this.toggleMenu("inventory"));
    window.addEventListener("ae:open-skills", () => this.toggleMenu("skills"));
    window.addEventListener("ae:open-map", () => this.toggleMenu("map"));
    window.addEventListener("ae:open-pause", () => this.togglePause());
    window.addEventListener("ae:show-death", (e) => {
      const detail = (e as CustomEvent<{ respawnSeconds?: number }>).detail;
      this.showDeath(detail?.respawnSeconds ?? 5);
    });
    window.addEventListener("ae:hide-death", () => this.hideDeath());
    this.applyHudVisibility();
  }

  // --- Tela inicial ---

  /** Mostra a tela inicial. Resolve "play" (Jogar) ou "continue" (Continuar). */
  showStart(): Promise<StartChoice> {
    this.hideStart();
    const saved = hasSavedGenome();
    const el = document.createElement("div");
    el.id = "start-screen";
    el.className = "ae-screen";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Tela inicial do Azure Edge");
    el.innerHTML =
      `<img class="ae-start-art" src="${LOADING_ART_URL}" alt="" aria-hidden="true" />` +
      `<div class="ae-start-shade"></div>` +
      `<div class="ae-start-content">` +
      `<h1 class="ae-logo">AZURE <span>EDGE</span></h1>` +
      `<p class="ae-tagline">Hack &amp; slash no deserto de Serket — browser, sem download.</p>` +
      `<div class="ae-start-actions">` +
      `<button type="button" class="ae-btn ae-btn-primary ae-btn-big" id="ae-start-play">Jogar</button>` +
      (saved
        ? `<button type="button" class="ae-btn ae-btn-big" id="ae-start-continue">Continuar</button>`
        : "") +
      `</div>` +
      (saved
        ? `<p class="ae-start-note">Personagem salvo encontrado — Continuar entra direto no mundo.</p>`
        : `<p class="ae-start-note">Primeira vez aqui? Jogar abre o criador de personagem.</p>`) +
      `<p class="ae-start-meta">Versão ${this.opts.version ?? "0.1.0"} · servidor: ${this.opts.serverLabel ?? "Render free"}</p>` +
      `</div>`;
    this.root.appendChild(el);
    const play = el.querySelector<HTMLButtonElement>("#ae-start-play");
    const cont = el.querySelector<HTMLButtonElement>("#ae-start-continue");
    play?.addEventListener("click", () => this.resolveStart("play"));
    cont?.addEventListener("click", () => this.resolveStart("continue"));
    // Com genome salvo, Continuar é a ação pré-selecionada (foco inicial).
    (cont ?? play)?.focus();
    return new Promise((resolve) => {
      this.startResolve = resolve;
    });
  }

  private resolveStart(choice: StartChoice): void {
    this.hideStart();
    if (choice === "play") this.opts.onPlay?.();
    else this.opts.onContinue?.();
    this.startResolve?.(choice);
    this.startResolve = null;
  }

  hideStart(): void {
    document.getElementById("start-screen")?.remove();
  }

  // --- Loading (progresso real) ---

  /** Garante o overlay de loading (reaproveita o #loading do index.html). */
  showLoading(): void {
    let el = document.getElementById("loading");
    if (!el) {
      el = document.createElement("div");
      el.id = "loading";
      el.innerHTML =
        `<img src="${LOADING_ART_URL}" alt="Azure Edge — Serket" />` +
        `<div class="loading-overlay"><div class="loading-text">Carregando…</div>` +
        `<div class="loading-bar"><div id="loading-fill"></div></div>` +
        `<div class="loading-stage" id="loading-stage"></div>` +
        `<div class="loading-tip" id="loading-tip"></div></div>`;
      document.body.appendChild(el);
    }
    // Completa o #loading legado (barra animada falsa) com elementos reais.
    const bar = el.querySelector(".loading-bar");
    if (bar && !document.getElementById("loading-fill")) {
      bar.innerHTML = `<div id="loading-fill"></div>`;
    }
    const overlay = el.querySelector(".loading-overlay");
    if (overlay) {
      if (!document.getElementById("loading-stage")) {
        const s = document.createElement("div");
        s.className = "loading-stage";
        s.id = "loading-stage";
        overlay.appendChild(s);
      }
      if (!document.getElementById("loading-tip")) {
        const t = document.createElement("div");
        t.className = "loading-tip";
        t.id = "loading-tip";
        overlay.appendChild(t);
      }
    }
    el.classList.remove("done");
    this.loadingEl = el;
    this.loadingStage = 0;
    this.setLoadingStage(0, 0);
    this.tipIndex = 0;
    this.setTip(0);
    this.tipTimer = window.setInterval(() => {
      this.tipIndex = nextTipIndex(this.tipIndex);
      this.setTip(this.tipIndex);
    }, 6000);
  }

  private setTip(i: number): void {
    const tip = document.getElementById("loading-tip");
    if (tip) tip.textContent = `Dica: ${LOADING_TIPS[i] ?? LOADING_TIPS[0] ?? ""}`;
  }

  /** Etapa atual (0 = conectar, 1 = baixar GLB, 2 = entrar na zona). */
  setLoadingStage(stageIndex: number, stageFraction = 0): void {
    this.loadingStage = Math.min(LOADING_STAGES.length - 1, Math.max(0, stageIndex));
    const stage = LOADING_STAGES[this.loadingStage];
    const fill = document.getElementById("loading-fill");
    if (fill) fill.style.width = `${(loadingFractionFor(this.loadingStage, stageFraction) * 100).toFixed(1)}%`;
    const label = document.getElementById("loading-stage");
    if (label && stage) label.textContent = stage.label;
    const text = this.loadingEl?.querySelector(".loading-text");
    if (text && stage) text.textContent = stage.label.replace("…", "");
  }

  /** Progresso de bytes dentro da etapa de download do GLB (etapa 1). */
  setLoadingBytes(loaded: number, total: number): void {
    const frac = total > 0 ? loaded / total : 0;
    this.setLoadingStage(1, frac);
    const label = document.getElementById("loading-stage");
    if (label) {
      label.textContent = total > 0
        ? `Baixando personagem… ${formatBytesProgress(loaded, total)}`
        : `Baixando personagem… ${formatBytesProgress(loaded, 0)}`;
    }
  }

  hideLoading(): void {
    if (this.tipTimer !== null) {
      window.clearInterval(this.tipTimer);
      this.tipTimer = null;
    }
    const el = this.loadingEl ?? document.getElementById("loading");
    if (!el) return;
    el.classList.add("done");
    window.setTimeout(() => el.remove(), 700);
    this.loadingEl = null;
  }

  // --- Morte / respawn ---

  showDeath(respawnSeconds = 5): void {
    this.hideDeath();
    this.deathResolved = false;
    const el = document.createElement("div");
    el.id = "death-screen";
    el.className = "ae-screen ae-overlay";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Você caiu");
    el.innerHTML =
      `<div class="ae-panel ae-death-panel">` +
      `<h2>Você caiu!</h2>` +
      `<p>Serket cobra seu preço… mas a luta continua.</p>` +
      `<p class="ae-countdown" aria-live="polite">Ressurgindo em <b id="ae-death-count">${formatCountdown(respawnSeconds)}</b></p>` +
      `<button type="button" class="ae-btn ae-btn-primary" id="ae-death-respawn">Ressuscitar agora</button>` +
      `<p class="ae-note">O respawn é automático. O mundo continua rodando enquanto você espera.</p>` +
      `</div>`;
    this.root.appendChild(el);
    this.deathEl = el;
    let remaining = respawnSeconds;
    const countEl = el.querySelector("#ae-death-count");
    this.deathTimer = window.setInterval(() => {
      remaining -= 1;
      if (countEl) countEl.textContent = formatCountdown(remaining);
      if (remaining <= 0) this.doRespawn();
    }, 1000);
    el.querySelector("#ae-death-respawn")?.addEventListener("click", () => this.doRespawn());
    el.querySelector<HTMLButtonElement>("#ae-death-respawn")?.focus();
  }

  private doRespawn(): void {
    if (this.deathResolved) return;
    this.deathResolved = true;
    this.hideDeath();
    window.dispatchEvent(new CustomEvent("ae:respawn"));
    this.opts.onRespawn?.();
  }

  hideDeath(): void {
    if (this.deathTimer !== null) {
      window.clearInterval(this.deathTimer);
      this.deathTimer = null;
    }
    this.deathEl?.remove();
    this.deathEl = null;
  }

  // --- Pausa ---

  showPause(): void {
    if (this.pauseEl) return;
    const el = document.createElement("div");
    el.id = "pause-screen";
    el.className = "ae-screen ae-overlay";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Pausa");
    el.innerHTML =
      `<div class="ae-panel">` +
      `<h2>Pausa</h2>` +
      `<p class="ae-note">O jogo está pausado só para você — o mundo continua rodando no servidor.</p>` +
      `<div class="ae-stack">` +
      `<button type="button" class="ae-btn ae-btn-primary" id="ae-pause-resume">Continuar</button>` +
      `<button type="button" class="ae-btn" id="ae-pause-settings">Configurações</button>` +
      `<button type="button" class="ae-btn" id="ae-pause-map">Mapa</button>` +
      `<button type="button" class="ae-btn ae-btn-danger" id="ae-pause-home">Voltar à tela inicial</button>` +
      `</div></div>`;
    this.root.appendChild(el);
    this.pauseEl = el;
    el.querySelector("#ae-pause-resume")?.addEventListener("click", () => this.hidePause());
    el.querySelector("#ae-pause-settings")?.addEventListener("click", () => {
      this.hidePause();
      this.openMenu("settings");
    });
    el.querySelector("#ae-pause-map")?.addEventListener("click", () => {
      this.hidePause();
      this.openMenu("map");
    });
    el.querySelector("#ae-pause-home")?.addEventListener("click", () => {
      if (this.opts.onReturnToStart) this.opts.onReturnToStart();
      else window.location.reload();
    });
    el.querySelector<HTMLButtonElement>("#ae-pause-resume")?.focus();
  }

  hidePause(): void {
    this.pauseEl?.remove();
    this.pauseEl = null;
  }

  togglePause(): void {
    if (this.deathEl) return;
    if (this.pauseEl) this.hidePause();
    else {
      this.closeAllMenus();
      this.showPause();
    }
  }

  // --- Menus genéricos ---

  isMenuOpen(kind: MenuKind): boolean {
    return this.openMenus.some((m) => m.kind === kind);
  }

  isAnyMenuOpen(): boolean {
    return this.openMenus.length > 0;
  }

  toggleMenu(kind: MenuKind): void {
    if (this.isMenuOpen(kind)) this.closeMenu(kind);
    else this.openMenu(kind);
  }

  openMenu(kind: MenuKind): void {
    this.hidePause();
    if (this.isMenuOpen(kind)) return;
    const el = document.createElement("div");
    el.className = "ae-menu";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", MENU_TITLES[kind]);
    el.innerHTML =
      `<div class="ae-menu-head"><h2>${MENU_TITLES[kind]}</h2>` +
      `<button type="button" class="ae-close" aria-label="Fechar">✕</button></div>` +
      `<div class="ae-menu-body"></div>`;
    el.querySelector(".ae-close")?.addEventListener("click", () => this.closeMenu(kind));
    const body = el.querySelector<HTMLElement>(".ae-menu-body");
    if (!body) return;
    if (kind === "inventory" || kind === "skills") el.classList.add("ae-menu-wide");
    if (kind === "inventory") this.renderInventory(body);
    if (kind === "skills") this.renderSkills(body);
    if (kind === "map") this.renderMap(body);
    if (kind === "settings") this.renderSettings(body);
    this.root.appendChild(el);
    this.openMenus.push({ kind, el });
    el.querySelector<HTMLButtonElement>(".ae-close")?.focus();
    if (kind === "map") this.startMapLoop();
  }

  closeMenu(kind: MenuKind): void {
    const idx = this.openMenus.findIndex((m) => m.kind === kind);
    if (idx < 0) return;
    if (kind === "map") this.stopMapLoop();
    this.openMenus[idx]?.el.remove();
    this.openMenus.splice(idx, 1);
  }

  closeAllMenus(): void {
    for (const m of [...this.openMenus]) this.closeMenu(m.kind);
  }

  /** Teclado global: I/K/M, remapeamento e Esc (fecha menu → pausa). */
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
      return;
    }
    if (this.capturingAction) return; // captura de tecla do remapeamento
    if (e.code === "Escape") {
      if (this.deathEl) return;
      if (this.openMenus.length > 0) {
        const top = this.openMenus[this.openMenus.length - 1];
        if (top) this.closeMenu(top.kind);
        e.preventDefault();
        return;
      }
      this.togglePause();
      e.preventDefault();
      return;
    }
    const action = actionForCode(this.bindings, e.code);
    if (action === "inventory" || action === "skills" || action === "map") {
      if (this.deathEl) return;
      this.toggleMenu(action);
      e.preventDefault();
    }
    // dodge / signatureSkill continuam no main.ts (não duplicar aqui).
  };

  // --- Inventário ---

  /** Silhueta do boneco (paper doll): slots sobre um humanoide simples.
   *  Slots de 46 px com folga vertical para o rótulo não colidir com o slot
   *  de baixo; acessório/arma recuados para o rótulo caber no boneco. */
  private dollSlotPosition(slot: EquipSlot): { left: string; top: string } {
    switch (slot) {
      case "head":
        return { left: "50%", top: "8%" };
      case "chest":
        return { left: "50%", top: "32%" };
      case "legs":
        return { left: "50%", top: "57%" };
      case "boots":
        return { left: "50%", top: "82%" };
      case "weapon":
        return { left: "84%", top: "42%" };
      case "accessory":
        return { left: "16%", top: "33%" };
    }
  }

  /** Miniatura do item: gradiente das cores da armadura ou letra inicial. */
  private itemThumb(item: InventoryItem): string {
    if (item.colors) {
      return `<span class="ae-thumb" style="background:linear-gradient(135deg, ${item.colors.primary}, ${item.colors.secondary});border-color:${item.colors.accent}" aria-hidden="true"></span>`;
    }
    const letter = item.kind === "consumable" ? "✚" : item.name.charAt(0);
    return `<span class="ae-thumb ae-thumb-letter" aria-hidden="true">${letter}</span>`;
  }

  /** Tooltip rico do item (stats, tier, nível, conjunto, preço, peso). */
  private itemTooltipHtml(item: InventoryItem): string {
    const clsName = item.classId ? (classById(item.classId)?.name ?? "") : "";
    const lines = [
      `<b style="color:${RARITY_COLORS[item.rarity]}">${item.name}</b>`,
      `<span>${RARITY_LABELS[item.rarity]} · ${item.kind === "armor" ? "Armadura" : item.kind === "weapon" ? "Arma" : item.kind === "consumable" ? "Consumível" : "Acessório"}${item.slot ? ` · ${SLOT_LABELS[item.slot]}` : ""}</span>`,
      ...item.stats.map((s) => `<span>• ${s}</span>`),
    ];
    if (item.setBonus) lines.push(`<span class="ae-tip-set">Bônus do conjunto: ${item.setBonus}</span>`);
    if (item.classId) lines.push(`<span>Classe: ${clsName}</span>`);
    lines.push(`<span>Tier ${item.tier} · requer nv ${item.minLevel} · peso ${item.weight}</span>`);
    lines.push(`<span>Vende por ${item.sellPrice} de ouro</span>`);
    return lines.join("");
  }

  private renderInventory(body: HTMLElement): void {
    const classId = this.opts.getClassId?.() ?? "espadachim";
    const cls = classById(classId);
    const progress = loadProgress();
    const catalog = buildItemCatalog();
    const byId = catalogById(catalog);
    // Sync com o equipado externo (tecla T, ?armor=): o estado local segue o jogo.
    let state = this.invState ?? loadInventoryState(classId);
    const extArmor = this.opts.getEquippedArmorId?.();
    if (extArmor) {
      const want = byId.get(`armor:${extArmor}`);
      if (want && state.equipped.chest !== want.id) state = equipItem(state, want);
    }
    this.invState = state;
    saveInventoryState(state);
    const entries = bagItems(state, catalog, this.invFilter, this.invSort);
    const weight = totalWeight(state, byId);
    const selected = this.invSelected ? byId.get(this.invSelected) : undefined;
    const msg = this.invMsgText;

    const dollSlots = SLOT_ORDER.map((slot) => {
      const itemId = state.equipped[slot];
      const item = itemId ? byId.get(itemId) : undefined;
      const pos = this.dollSlotPosition(slot);
      return `<button type="button" class="ae-doll-slot ${item ? "filled" : "empty"}" style="left:${pos.left};top:${pos.top}" data-item-id="${item?.id ?? ""}" data-slot="${slot}" aria-label="${SLOT_LABELS[slot]}${item ? `: ${item.name}` : " (vazio)"}" title="${SLOT_LABELS[slot]}${item ? ` — ${item.name}` : " — vazio"}">${item ? this.itemThumb(item) : `<span class="ae-doll-empty" aria-hidden="true">＋</span>`}<span class="ae-doll-label">${SLOT_LABELS[slot]}</span></button>`;
    }).join("");

    const cells = entries
      .map(({ item, qty }) => {
        const locked = progress.level < item.minLevel;
        const equipped = isEquipped(state, item.id);
        return `<button type="button" class="ae-bag-cell ${this.invSelected === item.id ? "sel" : ""} ${locked ? "locked" : ""}" style="border-color:${RARITY_COLORS[item.rarity]}" data-item-id="${item.id}" aria-label="${item.name}${qty > 1 ? ` ×${qty}` : ""}${locked ? ` (requer nv ${item.minLevel})` : ""}${equipped ? " (equipado)" : ""}" title="${item.name}">${this.itemThumb(item)}${qty > 1 ? `<span class="ae-qty">×${qty}</span>` : ""}${equipped ? `<span class="ae-cell-equipped">E</span>` : ""}${locked ? `<span class="ae-cell-lock">nv ${item.minLevel}</span>` : ""}</button>`;
      })
      .join("");

    let detail = `<p class="ae-note">Selecione um item na bolsa ou no boneco para ver os detalhes e as ações.</p>`;
    if (selected) {
      const equipped = isEquipped(state, selected.id);
      const check = selected.slot ? canEquip(selected, classId, progress.level, state) : null;
      const confirmDiscard = this.invConfirmDiscard === selected.id;
      detail =
        `<div class="ae-detail-card" style="border-color:${RARITY_COLORS[selected.rarity]}">` +
        `<div class="ae-detail-head">${this.itemThumb(selected)}<div><b style="color:${RARITY_COLORS[selected.rarity]}">${selected.name}</b><span>${RARITY_LABELS[selected.rarity]} · ${selected.kind === "armor" ? "Armadura" : selected.kind === "weapon" ? "Arma" : selected.kind === "consumable" ? "Consumível" : "Acessório"}${selected.slot ? ` · ${SLOT_LABELS[selected.slot]}` : ""}</span></div></div>` +
        `<p>${selected.description}</p>` +
        `<ul class="ae-detail-stats">${selected.stats.map((s) => `<li>${s}</li>`).join("")}</ul>` +
        (selected.setBonus ? `<p class="ae-item-bonus">Bônus do conjunto: ${selected.setBonus}</p>` : "") +
        `<p class="ae-note">Tier ${selected.tier} · requer nv ${selected.minLevel} · peso ${selected.weight} · vende por ${selected.sellPrice} de ouro${selected.classId ? ` · classe: ${classById(selected.classId)?.name ?? selected.classId}` : ""}</p>` +
        (equipped ? `<p><span class="ae-badge">Equipado</span></p>` : "") +
        `<div class="ae-detail-actions">` +
        (selected.slot && !equipped
          ? `<button type="button" class="ae-btn ae-btn-small ae-btn-primary" data-action="equip" ${check && !check.ok ? "disabled" : ""}>Equipar</button>`
          : "") +
        (selected.slot && equipped
          ? `<button type="button" class="ae-btn ae-btn-small" data-action="unequip">Desequipar</button>`
          : "") +
        (selected.kind === "consumable"
          ? `<button type="button" class="ae-btn ae-btn-small ae-btn-primary" data-action="use">Usar</button>`
          : "") +
        `<button type="button" class="ae-btn ae-btn-small" data-action="sell" ${equipped ? "disabled" : ""}>Vender por ${selected.sellPrice} ouro</button>` +
        (confirmDiscard
          ? `<button type="button" class="ae-btn ae-btn-small ae-btn-danger" data-action="discard-confirm">Confirmar descarte</button><button type="button" class="ae-btn ae-btn-small" data-action="discard-cancel">Cancelar</button>`
          : `<button type="button" class="ae-btn ae-btn-small ae-btn-danger" data-action="discard" ${equipped ? "disabled" : ""}>Descartar</button>`) +
        `</div>` +
        (check && !check.ok && !equipped ? `<p class="ae-note" role="status">${check.reason}</p>` : "") +
        `</div>`;
    }

    body.innerHTML =
      `<div class="ae-inv-head"><span class="ae-gold">◆ <b>${formatGold(state.gold)}</b> ouro</span><span>Peso <b>${weight}/${INVENTORY_CAPACITY}</b></span><span>${entries.length} ${entries.length === 1 ? "item" : "itens"} na bolsa</span></div>` +
      `<p class="ae-note">Inventário <b>local</b> — inventário, ouro e equipamentos NÃO são salvos no servidor ainda (ele não persiste nada). Equipar um conjunto aplica o visual na hora; o bônus de atributo vale a partir do próximo login.</p>` +
      `<div class="ae-inv-toolbar" role="group" aria-label="Filtro e ordenação">` +
      ITEM_FILTERS.map((f) => `<button type="button" class="ae-btn ae-btn-small ${this.invFilter === f.id ? "ae-btn-primary" : ""}" data-filter="${f.id}">${f.label}</button>`).join("") +
      `<select data-sort aria-label="Ordenar itens">${ITEM_SORTS.map((s) => `<option value="${s.id}" ${this.invSort === s.id ? "selected" : ""}>${s.label}</option>`).join("")}</select>` +
      `</div>` +
      `<div class="ae-inv-layout">` +
      `<div class="ae-doll" aria-label="Boneco de equipamento">` +
      `<svg class="ae-doll-svg" viewBox="0 0 100 200" aria-hidden="true"><circle cx="50" cy="18" r="12" /><rect x="34" y="34" width="32" height="46" rx="9" /><path d="M34 44 L18 78 M66 44 L82 78" /><rect x="36" y="82" width="12" height="58" rx="6" /><rect x="52" y="82" width="12" height="58" rx="6" /><rect x="34" y="140" width="14" height="16" rx="4" /><rect x="52" y="140" width="14" height="16" rx="4" /></svg>` +
      dollSlots +
      `</div>` +
      `<div class="ae-bag" role="list" aria-label="Itens da bolsa">${cells.length > 0 ? cells : `<p class="ae-note">Nenhum item neste filtro.</p>`}</div>` +
      `<div class="ae-inv-detail" data-detail>${detail}</div>` +
      `</div>` +
      `<p class="ae-inv-msg" role="status">${msg}</p>` +
      `<div class="ae-tooltip" hidden></div>`;

    const rerender = (message: string): void => {
      this.invMsgText = message;
      this.renderInventory(body);
    };
    const tooltip = body.querySelector<HTMLElement>(".ae-tooltip");
    const showTooltip = (itemId: string, x: number, y: number): void => {
      if (this.invTooltipLocked) return;
      const item = byId.get(itemId);
      if (!item || !tooltip) return;
      tooltip.innerHTML = this.itemTooltipHtml(item);
      tooltip.hidden = false;
      const w = 260;
      const h = 170;
      tooltip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x + 14))}px`;
      tooltip.style.top = `${Math.min(window.innerHeight - h - 8, Math.max(8, y + 14))}px`;
    };
    const hideTooltip = (): void => {
      if (tooltip) tooltip.hidden = true;
    };
    const bindHover = (container: HTMLElement | null): void => {
      container?.addEventListener("mouseover", (e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>("[data-item-id]");
        const id = target?.dataset.itemId;
        if (id) showTooltip(id, e.clientX, e.clientY);
      });
      container?.addEventListener("mousemove", (e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>("[data-item-id]");
        const id = target?.dataset.itemId;
        if (id && tooltip && !tooltip.hidden) showTooltip(id, e.clientX, e.clientY);
      });
      container?.addEventListener("mouseout", hideTooltip);
      container?.addEventListener("mouseleave", () => {
        this.invTooltipLocked = false;
      });
    };
    bindHover(body.querySelector(".ae-bag"));
    bindHover(body.querySelector(".ae-doll"));

    body.querySelector(".ae-inv-toolbar")?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-filter]");
      if (!btn) return;
      this.invFilter = btn.dataset.filter as ItemFilter;
      this.invConfirmDiscard = null;
      this.renderInventory(body);
    });
    body.querySelector<HTMLSelectElement>("[data-sort]")?.addEventListener("change", (e) => {
      this.invSort = (e.target as HTMLSelectElement).value as ItemSort;
      this.renderInventory(body);
    });
    body.querySelector(".ae-inv-layout")?.addEventListener("click", (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-item-id]");
      const actionBtn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
      if (actionBtn) {
        const item = selected;
        if (!item) return;
        const action = actionBtn.dataset.action;
        if (action === "equip") {
          const check = canEquip(item, classId, progress.level, this.invState ?? state);
          if (!check.ok) {
            rerender(check.reason);
            return;
          }
          this.invState = equipItem(this.invState ?? state, item);
          saveInventoryState(this.invState);
          if (item.armorId) {
            window.dispatchEvent(new CustomEvent("ae:equip-armor", { detail: { armorId: item.armorId } }));
            this.opts.onEquipArmor?.(item.armorId);
          }
          rerender(`${item.name} equipado — visual aplicado na hora (local).`);
          return;
        }
        if (action === "unequip" && item.slot) {
          this.invState = unequipSlot(this.invState ?? state, item.slot);
          saveInventoryState(this.invState);
          if (item.armorId) {
            window.dispatchEvent(new CustomEvent("ae:equip-armor", { detail: { armorId: null } }));
            this.opts.onEquipArmor?.(null);
          }
          rerender(`${item.name} desequipado e guardado na bolsa.`);
          return;
        }
        if (action === "use") {
          const res = useConsumable(this.invState ?? state, item);
          if (!res.ok) {
            rerender(res.reason);
            return;
          }
          this.invState = res.state;
          saveInventoryState(this.invState);
          const heal = item.healHp ?? 0;
          const mana = item.restoreMana ?? 0;
          window.dispatchEvent(
            new CustomEvent("ae:use-potion", { detail: { name: item.name, healHp: heal, restoreMana: mana } }),
          );
          rerender(
            heal > 0
              ? `Você usou ${item.name} e recuperou ${heal} de HP (efeito local — o servidor ainda não aplica consumíveis).`
              : `Você usou ${item.name} e recuperou ${mana} de mana (efeito local).`,
          );
          return;
        }
        if (action === "sell") {
          const res = sellItem(this.invState ?? state, item);
          if (!res.ok) {
            rerender(res.reason);
            return;
          }
          this.invState = res.state;
          saveInventoryState(this.invState);
          rerender(`${item.name} vendido por ${res.gained} de ouro (local). Saldo: ${formatGold(res.state.gold)} ouro.`);
          return;
        }
        if (action === "discard") {
          this.invConfirmDiscard = item.id;
          this.renderInventory(body);
          return;
        }
        if (action === "discard-confirm") {
          const res = discardItem(this.invState ?? state, item);
          if (!res.ok) {
            rerender(res.reason);
            return;
          }
          this.invState = res.state;
          this.invConfirmDiscard = null;
          if (this.invSelected === item.id) this.invSelected = null;
          saveInventoryState(this.invState);
          rerender(`${item.name} descartado (sem ouro de volta).`);
          return;
        }
        if (action === "discard-cancel") {
          this.invConfirmDiscard = null;
          this.renderInventory(body);
          return;
        }
        return;
      }
      if (cell?.dataset.itemId) {
        this.invSelected = cell.dataset.itemId;
        this.invConfirmDiscard = null;
        this.invTooltipLocked = true;
        hideTooltip();
        this.renderInventory(body);
      }
    });
  }

  // --- Skills ---

  /** Linhas SVG que ligam os nós da árvore (coordenadas em % da árvore). */
  private treeConnectorPath(): string {
    // Centros das linhas: raiz 16,7% · galhos 50% · ocultos 83,3%; ônibus a 33,3% e 66,7%.
    return (
      "M50 16.7 V33.3 M16.7 33.3 H83.3 M16.7 33.3 V50 M50 33.3 V50 M83.3 33.3 V50 " +
      "M50 50 V66.7 M12.5 66.7 H87.5 M12.5 66.7 V83.3 M37.5 66.7 V83.3 M62.5 66.7 V83.3 M87.5 66.7 V83.3"
    );
  }

  private nodeShortLabel(node: TreeNodeView): string {
    switch (node.state) {
      case "unlocked":
        return "Ativa · Q";
      case "other-class":
        return node.classId ? (classById(node.classId)?.name ?? "") : "";
      case "hidden":
        return "Oculta";
    }
  }

  private renderSkills(body: HTMLElement): void {
    const classId = this.opts.getClassId?.() ?? "espadachim";
    const cls = classById(classId);
    const progress = loadProgress();
    const nodes = skillTreeNodes(classId);
    const selected = nodes.find((n) => n.id === this.skillSelected) ?? nodes.find((n) => n.row === 0) ?? nodes[0];
    const xpNeed = xpToNextLevel(progress.level);
    const xpPct = Math.round(xpFraction(progress) * 100);

    const nodeHtml = (node: TreeNodeView): string =>
      `<div class="ae-tree-node"><button type="button" class="ae-node-btn ae-node-${node.state} ${selected?.id === node.id ? "sel" : ""}" data-node="${node.id}" aria-pressed="${selected?.id === node.id}" aria-label="${node.label} — ${nodeStateLabel(node)}">${node.icon ? `<img src="${node.icon}" alt="" draggable="false" />` : `<span class="ae-node-hidden" aria-hidden="true">?</span>`}</button><span class="ae-node-name">${node.label}</span><span class="ae-node-state">${this.nodeShortLabel(node)}</span></div>`;

    const rows = [0, 1, 2]
      .map(
        (row) =>
          `<div class="ae-tree-row">${nodes.filter((n) => n.row === row).map(nodeHtml).join("")}</div>`,
      )
      .join("");

    let detail = "";
    if (!selected) {
      detail = `<p class="ae-note">Nenhuma skill para mostrar.</p>`;
    } else if (selected.skillId) {
      const skill = skillById(selected.skillId);
      if (!skill) {
        detail = `<p class="ae-note">Skill não encontrada nos dados.</p>`;
      } else {
        const skillCls = classById(skill.classId);
        detail =
          `<div class="ae-detail-card" style="border-color:#d4a017">` +
          `<div class="ae-detail-head">${selected.icon ? `<img class="ae-skill-icon" src="${selected.icon}" alt="Ícone de ${skill.name}" />` : ""}<div><b>${skill.name}</b><span>${skillCls?.name ?? skill.classId} · ${skillKindLabel(skill.kind)} · assinatura</span></div></div>` +
          `<ul class="ae-detail-stats">${skillEffectLines(skill).map((l) => `<li>${l}</li>`).join("")}</ul>` +
          `<p class="ae-note">Custo: <b>${skill.costMana} de mana</b> · Recarga: <b>${skill.cooldownS} s</b> · Tecla: <b>Q</b></p>` +
          (skill.description ? `<p>${skill.description}</p>` : "") +
          (skill.animation ? `<p class="ae-note">Animação: ${skill.animation}</p>` : "") +
          (selected.state === "unlocked"
            ? `<p><span class="ae-badge ae-badge-active">Funciona no servidor — tecla Q</span></p><p class="ae-note">É a única skill que executa no servidor hoje. As outras chegam em M3.</p>`
            : `<p><span class="ae-badge">Outra classe · ${skillCls?.name ?? ""}</span></p><p class="ae-note">Pertence a ${skillCls?.name ?? skill.classId} — este personagem não pode aprendê-la. Para usá-la, crie um personagem dessa classe.</p>`) +
          `</div>`;
      }
    } else {
      detail =
        `<div class="ae-detail-card ae-detail-hidden">` +
        `<div class="ae-detail-head"><span class="ae-node-hidden ae-node-hidden-big" aria-hidden="true">?</span><div><b>Skill oculta</b><span>??? · em breve (M3)</span></div></div>` +
        `<p>Este slot ainda não foi revelado. Novas skills chegam em M3 — nenhum nome, número ou efeito foi inventado aqui.</p>` +
        `<p class="ae-note">Por enquanto, as 4 skills iniciais são as assinaturas: uma por classe, com ícone real e detalhe completo.</p>` +
        `</div>`;
    }

    body.innerHTML =
      `<div class="ae-xp-head"><span class="ae-xp-class"><b>${cls?.name ?? classId}</b> · nv ${progress.level}</span>` +
      `<span class="ae-xp-bar" role="progressbar" aria-valuenow="${progress.xp}" aria-valuemax="${xpNeed}" aria-label="Experiência"><span class="ae-xp-fill" style="width:${xpPct}%"></span><span class="ae-xp-text">${progress.xp}/${xpNeed} XP</span></span>` +
      `<span class="ae-skill-points">✦ ${progress.skillPoints} ${progress.skillPoints === 1 ? "ponto" : "pontos"} de skill</span></div>` +
      `<p class="ae-note">Árvore de skills — as 4 skills iniciais são as assinaturas (uma por classe). Progressão (nv/XP/pontos) é <b>local</b>: o servidor ainda não envia XP nem nível.</p>` +
      `<div class="ae-skill-layout"><div class="ae-tree" role="tree" aria-label="Árvore de skills">` +
      `<svg class="ae-tree-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${this.treeConnectorPath()}" /></svg>` +
      rows +
      `</div><div class="ae-skill-detail" data-detail>${detail}</div></div>` +
      `<p class="ae-note">Só a assinatura (Q) da sua classe executa no servidor hoje. As outras 3 assinaturas pertencem às outras classes; os slots “???” são skills futuras, sem arte nem funcionalidade inventada.</p>`;

    body.querySelector(".ae-tree")?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-node]");
      if (!btn?.dataset.node) return;
      this.skillSelected = btn.dataset.node;
      this.renderSkills(body);
    });
  }

  // --- Mapa ---

  // --- Mapa ---

  private renderMap(body: HTMLElement): void {
    const currentId = this.opts.getZoneId?.() ?? ZONE.zone.id;
    this.mapZoneId = currentId;
    body.innerHTML =
      `<p class="ae-note">Mapa informativo — a viagem entre zonas ainda não é feita por aqui.</p>` +
      `<div class="ae-map-tabs" role="tablist">${this.mapZoneOptions().map((z) =>
        `<button type="button" class="ae-btn ae-btn-small ${z.id === this.mapZoneId ? "ae-btn-primary" : ""}" data-zone="${z.id}">${z.name}</button>`,
      ).join("")}</div>` +
      `<canvas id="ae-map-canvas" width="640" height="420" aria-label="Mapa da zona"></canvas>` +
      `<div class="ae-legend"><span><i class="dot dot-player"></i>Você</span><span><i class="dot dot-npc"></i>NPC</span><span><i class="dot dot-portal"></i>Portal</span><span><i class="dot dot-spawn"></i>Renascimento</span></div>` +
      `<div class="ae-map-info" id="ae-map-info"></div>`;
    body.querySelectorAll<HTMLButtonElement>("[data-zone]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.mapZoneId = btn.dataset.zone ?? currentId;
        this.renderMap(body);
      });
    });
    this.mapCanvas = body.querySelector<HTMLCanvasElement>("#ae-map-canvas");
    this.drawMap();
  }

  private mapZoneOptions(): Array<{ id: string; name: string }> {
    const zones: Array<{ id: string; name: string }> = [
      { id: "cidade_serket", name: "Cidade de Serket" },
      { id: "dunas_serket", name: "Dunas de Serket" },
    ];
    for (const d of DUNGEONS) zones.push({ id: d.id, name: d.name });
    return zones;
  }

  private startMapLoop(): void {
    const loop = (): void => {
      if (!this.isMenuOpen("map")) return;
      this.drawMap();
      this.mapRaf = requestAnimationFrame(loop);
    };
    this.mapRaf = requestAnimationFrame(loop);
  }

  private stopMapLoop(): void {
    cancelAnimationFrame(this.mapRaf);
    this.mapCanvas = null;
  }

  private drawMap(): void {
    const canvas = this.mapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const zoneId = this.mapZoneId ?? ZONE.zone.id;
    const dungeon = DUNGEONS.find((d) => d.id === zoneId);
    const zone: ZoneData | undefined = zoneById(zoneId);
    const name = dungeon?.name ?? zone?.zone.name ?? zoneId;
    const sizeM = zone?.zone.sizeM ?? 100;
    const W = canvas.width;
    const H = canvas.height;
    const scale = Math.min(W, H) / sizeM;
    const ox = (W - sizeM * scale) / 2;
    const oy = (H - sizeM * scale) / 2;
    const toX = (x: number): number => ox + (x + sizeM / 2) * scale;
    const toY = (y: number): number => oy + (sizeM / 2 - y) * scale;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0e2233";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = zone?.palette.ground ?? "#3a2f1d";
    ctx.fillRect(ox, oy, sizeM * scale, sizeM * scale);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= sizeM; gx += 10) {
      ctx.beginPath();
      ctx.moveTo(toX(gx - sizeM / 2), toY(sizeM / 2));
      ctx.lineTo(toX(gx - sizeM / 2), toY(-sizeM / 2));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(toX(-sizeM / 2), toY(gx - sizeM / 2));
      ctx.lineTo(toX(sizeM / 2), toY(gx - sizeM / 2));
      ctx.stroke();
    }
    ctx.fillStyle = "#eaf6ff";
    ctx.font = "bold 15px system-ui, sans-serif";
    ctx.fillText(name, 12, 22);
    if (dungeon) {
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "#ffb020";
      ctx.fillText(`Dungeon nv ${dungeon.levelMin}–${dungeon.levelMax} · boss: ${dungeon.boss.name} · máx. ${dungeon.maxPlayers} jogadores`, 12, 40);
    } else if (zone) {
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "#cfe3f2";
      ctx.fillText(`nv ${zone.levelMin ?? 1}–${zone.levelMax ?? 10}${zone.safe ? " · área segura" : ""}`, 12, 40);
    }
    // Rótulos com anti-colisão: NPCs/portais ficam agrupados na praça e os
    // textos se sobrepunham. Cada rótulo tenta 6 posições ao redor do ponto
    // e fica na primeira sem colidir com rótulos já desenhados (com fundo
    // escuro para legibilidade sobre o mapa).
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const label = (x: number, y: number, text: string): void => {
      ctx.font = "11px system-ui, sans-serif";
      const w = ctx.measureText(text).width;
      const h = 14;
      const candidates: [number, number][] = [
        [x + 8, y - h / 2],
        [x - w - 8, y - h / 2],
        [x + 8, y + 6],
        [x - w - 8, y + 6],
        [x + 8, y - h - 6],
        [x - w - 8, y - h - 6],
      ];
      let chosen = candidates[0] ?? [x + 8, y - h / 2];
      for (const [cx, cy] of candidates) {
        const inside = cx >= 4 && cy >= 4 && cx + w <= W - 4 && cy + h <= H - 4;
        const collides = placed.some(
          (r) => cx < r.x + r.w + 2 && cx + w + 2 > r.x && cy < r.y + r.h + 2 && cy + h + 2 > r.y,
        );
        if (inside && !collides) {
          chosen = [cx, cy];
          break;
        }
      }
      const [lx, ly] = chosen;
      ctx.fillStyle = "rgba(6, 18, 30, 0.85)";
      ctx.fillRect(lx - 3, ly - 1, w + 6, h + 2);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, lx, ly + 11);
      placed.push({ x: lx - 3, y: ly - 1, w: w + 6, h: h + 2 });
    };
    const spawn = zone?.zone.spawn ?? { x: 0, y: 0 };
    ctx.fillStyle = "#7cc4ff";
    ctx.beginPath();
    ctx.arc(toX(spawn.x), toY(spawn.y), 5, 0, Math.PI * 2);
    ctx.fill();
    // O jogador nasce no ponto de renascimento: sem pular o rótulo, "Você"
    // e "Renascimento" caem no mesmo lugar e nenhum candidato fica livre.
    const playerPos = this.opts.getPlayerPosition?.();
    const nearSpawn = playerPos && Math.hypot(playerPos.x - spawn.x, playerPos.y - spawn.y) < 3;
    if (!nearSpawn) label(toX(spawn.x), toY(spawn.y), "Renascimento");
    for (const npc of zone?.npcs ?? []) {
      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.arc(toX(npc.x), toY(npc.y), 4, 0, Math.PI * 2);
      ctx.fill();
      label(toX(npc.x), toY(npc.y), `${npc.name} (${npc.role})`);
    }
    for (const portal of zone?.portals ?? []) {
      ctx.fillStyle = "#46c46a";
      ctx.save();
      ctx.translate(toX(portal.x), toY(portal.y));
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
      label(toX(portal.x), toY(portal.y), `Portal: ${portal.label}`);
    }
    if (dungeon) {
      ctx.fillStyle = "#e5484d";
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.fillText(`Boss: ${dungeon.boss.name} (nv ${dungeon.boss.level})`, 12, H - 12);
    }
    const pos = this.opts.getPlayerPosition?.();
    if (pos && (!dungeon || zoneId === (this.opts.getZoneId?.() ?? ""))) {
      ctx.fillStyle = "#ff5a3c";
      ctx.beginPath();
      ctx.arc(toX(pos.x), toY(pos.y), 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      label(toX(pos.x), toY(pos.y), "Você");
    }
    const info = document.getElementById("ae-map-info");
    if (info) {
      const cityNpcs = zoneId === "cidade_serket" ? CITY.npcs : [];
      info.innerHTML =
        (zone ? `<p>${zone.zone.name} — ${zone.zone.subArea ?? ""}</p>` : "") +
        (cityNpcs.length > 0
          ? `<p>NPCs da cidade: ${cityNpcs.map((n) => `${n.name} (${n.role})`).join(" · ")}.</p>`
          : "") +
        (dungeon ? `<p>Entrada: ${dungeon.entrance?.zone ?? "—"}${dungeon.lockoutHours ? ` · bloqueio de loot: ${dungeon.lockoutHours} h` : ""}.</p>` : "");
    }
  }

  // --- Configurações ---

  private renderSettings(body: HTMLElement): void {
    const s = { ...this.settings };
    body.innerHTML =
      `<div class="ae-setting"><label for="ae-set-quality">Qualidade gráfica</label>
        <select id="ae-set-quality">
          ${(Object.keys(QUALITY_LABELS) as Quality[]).map((q) => `<option value="${q}" ${s.quality === q ? "selected" : ""}>${QUALITY_LABELS[q]}</option>`).join("")}
        </select>
        <span class="ae-note" id="ae-set-quality-note">${this.opts.onQuality ? "" : "Sem ligação com o render: a qualidade aplica ao recarregar."}</span></div>` +
      `<div class="ae-setting"><label for="ae-set-volume">Volume</label>
        <input id="ae-set-volume" type="range" min="0" max="100" step="1" value="${s.volume}" />
        <span id="ae-set-volume-val">${s.volume}%</span>
        <span class="ae-note">Salvo localmente (ainda não há áudio no jogo).</span></div>` +
      `<div class="ae-setting"><label for="ae-set-zoom">Sensibilidade do zoom</label>
        <input id="ae-set-zoom" type="range" min="0.5" max="2" step="0.1" value="${s.zoomSensitivity}" />
        <span id="ae-set-zoom-val">${s.zoomSensitivity.toFixed(1)}x</span></div>` +
      `<div class="ae-setting"><label><input id="ae-set-hud" type="checkbox" ${s.showHud ? "checked" : ""} /> Mostrar HUD</label></div>` +
      `<h3>Teclas</h3><p class="ae-note">Clique em “Trocar”, depois pressione a tecla. Teclas já usadas são recusadas.</p>` +
      `<div class="ae-keys">${(Object.keys(KEY_ACTION_LABELS) as KeyAction[]).map((a) =>
        `<div class="ae-key-row"><span>${KEY_ACTION_LABELS[a]}</span><b>${prettyKey(this.bindings[a] ?? "")}</b><button type="button" class="ae-btn ae-btn-small" data-rebind="${a}">Trocar</button></div>`,
      ).join("")}</div>` +
      `<p class="ae-note" id="ae-keys-msg" role="status"></p>` +
      `<p class="ae-note">Configurações salvas em localStorage. Menus não pausam o servidor.</p>`;
    const save = (): void => {
      this.settings = { ...s };
      saveSettings(this.settings);
      window.dispatchEvent(new CustomEvent("ae:settings-changed", { detail: { ...this.settings } }));
    };
    body.querySelector("#ae-set-quality")?.addEventListener("change", (e) => {
      const q = (e.target as HTMLSelectElement).value as Quality;
      s.quality = q;
      save();
      this.opts.onQuality?.(q);
      const note = body.querySelector("#ae-set-quality-note");
      if (note) note.textContent = this.opts.onQuality ? "Qualidade aplicada." : "Salvo — aplica ao recarregar.";
    });
    body.querySelector("#ae-set-volume")?.addEventListener("input", (e) => {
      s.volume = Number((e.target as HTMLInputElement).value);
      const val = body.querySelector("#ae-set-volume-val");
      if (val) val.textContent = `${s.volume}%`;
      save();
    });
    body.querySelector("#ae-set-zoom")?.addEventListener("input", (e) => {
      s.zoomSensitivity = Number((e.target as HTMLInputElement).value);
      const val = body.querySelector("#ae-set-zoom-val");
      if (val) val.textContent = `${s.zoomSensitivity.toFixed(1)}x`;
      save();
    });
    body.querySelector("#ae-set-hud")?.addEventListener("change", (e) => {
      s.showHud = (e.target as HTMLInputElement).checked;
      save();
      this.applyHudVisibility();
      this.opts.onToggleHud?.(s.showHud);
    });
    body.querySelectorAll<HTMLButtonElement>("[data-rebind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.rebind as KeyAction;
        this.capturingAction = action;
        const msg = body.querySelector("#ae-keys-msg");
        if (msg) msg.textContent = `Pressione uma tecla para “${KEY_ACTION_LABELS[action]}”… (Esc cancela)`;
        btn.textContent = "Aguardando tecla…";
        const capture = (ev: KeyboardEvent): void => {
          ev.preventDefault();
          ev.stopPropagation();
          window.removeEventListener("keydown", capture, true);
          this.capturingAction = null;
          if (ev.code === "Escape") {
            this.renderSettings(body);
            return;
          }
          const result = rebindKey(this.bindings, action, ev.code);
          if (result.conflict) {
            if (msg) {
              msg.textContent = `“${prettyKey(ev.code)}” já é ${KEY_ACTION_LABELS[result.conflict]}. Escolha outra tecla.`;
            }
            btn.textContent = "Trocar";
            return;
          }
          this.bindings = result.bindings;
          saveKeyBindings(this.bindings);
          this.renderSettings(body);
        };
        window.addEventListener("keydown", capture, true);
      });
    });
  }

  private applyHudVisibility(): void {
    const show = this.settings.showHud;
    for (const id of ["hud", "help"]) {
      const el = document.getElementById(id);
      if (el) el.style.display = show ? "" : "none";
    }
  }

  // --- Getters úteis para main.ts ---

  getBindings(): KeyBindings {
    return { ...this.bindings };
  }

  getSettings(): Settings {
    return { ...this.settings };
  }

  getAvailableClasses(): typeof CLASSES {
    return CLASSES;
  }
}
