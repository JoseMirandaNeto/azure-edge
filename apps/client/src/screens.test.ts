import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_KEY_BINDINGS,
  DEFAULT_SETTINGS,
  LOADING_STAGES,
  actionForCode,
  formatBytesProgress,
  formatCountdown,
  loadKeyBindings,
  loadSettings,
  loadingFractionFor,
  nextTipIndex,
  prettyKey,
  rebindKey,
  saveKeyBindings,
  saveSettings,
  validateCharacterName,
} from "./screens.js";

/** localStorage em memória (vitest roda em node, sem DOM). */
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

describe("validateCharacterName", () => {
  it("aceita nomes válidos (3–16, com acento)", () => {
    expect(validateCharacterName("Mira")).toEqual({ valid: true, error: null });
    expect(validateCharacterName("João das Dunas")).toEqual({ valid: true, error: null });
    expect(validateCharacterName("Ana-3_X")).toEqual({ valid: true, error: null });
    expect(validateCharacterName("  Mira  ")).toEqual({ valid: true, error: null });
  });

  it("rejeita nome curto, longo e vazio", () => {
    expect(validateCharacterName("").valid).toBe(false);
    expect(validateCharacterName("Al").valid).toBe(false);
    expect(validateCharacterName("A".repeat(17)).valid).toBe(false);
    expect(validateCharacterName("A".repeat(16)).valid).toBe(true);
    expect(validateCharacterName("Abc").valid).toBe(true);
  });

  it("rejeita caracteres inválidos e espaços duplos, com erro em pt-BR", () => {
    const bad = validateCharacterName("Mira@!");
    expect(bad.valid).toBe(false);
    expect(bad.error).toMatch(/apenas letras/);
    expect(validateCharacterName("Mira  Sol").valid).toBe(false);
  });
});

describe("remapeamento de teclas", () => {
  it("padrões: I inventário, K skills, M mapa, Esc pausa", () => {
    expect(DEFAULT_KEY_BINDINGS.inventory).toBe("KeyI");
    expect(DEFAULT_KEY_BINDINGS.skills).toBe("KeyK");
    expect(DEFAULT_KEY_BINDINGS.map).toBe("KeyM");
    expect(DEFAULT_KEY_BINDINGS.pause).toBe("Escape");
  });

  it("rebindKey troca a tecla e não mexe nas outras", () => {
    const { bindings, conflict } = rebindKey(DEFAULT_KEY_BINDINGS, "inventory", "KeyB");
    expect(conflict).toBeNull();
    expect(bindings.inventory).toBe("KeyB");
    expect(bindings.skills).toBe("KeyK");
    expect(actionForCode(bindings, "KeyB")).toBe("inventory");
  });

  it("rebindKey recusa tecla já usada e indica o conflito", () => {
    const { bindings, conflict } = rebindKey(DEFAULT_KEY_BINDINGS, "inventory", "KeyK");
    expect(conflict).toBe("skills");
    expect(bindings).toBe(DEFAULT_KEY_BINDINGS);
  });

  it("actionForCode retorna null para tecla sem ação", () => {
    expect(actionForCode(DEFAULT_KEY_BINDINGS, "KeyZ")).toBeNull();
  });

  it("prettyKey traduz códigos para rótulos legíveis", () => {
    expect(prettyKey("KeyI")).toBe("I");
    expect(prettyKey("Digit5")).toBe("5");
    expect(prettyKey("Escape")).toBe("Esc");
    expect(prettyKey("Space")).toBe("Espaço");
  });

  it("load/save de keybindings sobrevive via localStorage", () => {
    const custom = { ...DEFAULT_KEY_BINDINGS, inventory: "KeyB" };
    saveKeyBindings(custom);
    expect(loadKeyBindings().inventory).toBe("KeyB");
    saveKeyBindings(DEFAULT_KEY_BINDINGS);
    expect(loadKeyBindings()).toEqual(DEFAULT_KEY_BINDINGS);
  });
});

describe("configurações", () => {
  it("padrões sensatos e load/save com clamp", () => {
    expect(DEFAULT_SETTINGS).toEqual({ quality: "med", volume: 80, zoomSensitivity: 1, showHud: true });
    saveSettings({ quality: "high", volume: 250, zoomSensitivity: 9, showHud: false });
    expect(loadSettings()).toEqual({ quality: "high", volume: 100, zoomSensitivity: 2, showHud: false });
    saveSettings(DEFAULT_SETTINGS);
  });

  it("loadSettings ignora JSON corrompido", () => {
    localStorage.setItem("azure-edge:settings:v1", "{não-json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.removeItem("azure-edge:settings:v1");
  });
});

describe("progresso de loading", () => {
  it("etapas somam 1 e a fração cresce monotonicamente", () => {
    const total = LOADING_STAGES.reduce((acc, s) => acc + s.weight, 0);
    expect(total).toBeCloseTo(1);
    expect(loadingFractionFor(0, 0)).toBe(0);
    expect(loadingFractionFor(0, 1)).toBeCloseTo(0.2);
    expect(loadingFractionFor(1, 0.5)).toBeCloseTo(0.5);
    expect(loadingFractionFor(1, 1)).toBeCloseTo(0.8);
    expect(loadingFractionFor(2, 1)).toBeCloseTo(1);
    expect(loadingFractionFor(99, 2)).toBeCloseTo(1);
    expect(loadingFractionFor(-1, -1)).toBe(0);
  });

  it("formatBytesProgress usa MB com vírgula decimal", () => {
    expect(formatBytesProgress(0, 0)).toBe("0,0 MB baixados");
    expect(formatBytesProgress(12582912, 25165824)).toBe("12,0 MB de 24,0 MB");
  });
});

describe("dicas e contador", () => {
  it("nextTipIndex é cíclico", () => {
    expect(nextTipIndex(0)).toBe(1);
    expect(nextTipIndex(9)).toBe(0);
  });

  it("formatCountdown arredonda para cima e nunca é negativo", () => {
    expect(formatCountdown(5)).toBe("5 s");
    expect(formatCountdown(4.2)).toBe("5 s");
    expect(formatCountdown(0)).toBe("0 s");
    expect(formatCountdown(-3)).toBe("0 s");
  });
});
