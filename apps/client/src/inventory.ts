/**
 * Inventário do Azure Edge — lógica pura + estado local (testada em
 * inventory.test.ts). Tudo aqui é LOCAL: inventário, ouro e equipamentos
 * NÃO são persistidos no servidor (ele ainda não tem persistência); o
 * estado vive em localStorage e o visual da armadura aplica na hora via
 * `ae:equip-armor` (a integração existente em screens.ts/main.ts).
 *
 * Catálogo (sem inventar sistema de servidor):
 * - 12 conjuntos de armadura do gamedata (3/classe, tiers lv 1/8/16).
 *   Raridade por tier: 1 = Comum, 2 = Raro, 3 = Épico.
 * - Arma da classe (nome vem de `classes.json`: "Duas espadas", etc.).
 * - 1 acessório de exemplo sem bônus mecânico (só flavor local).
 * - 2 consumíveis de exemplo: Poção de Vida (cura 50 de HP local) e
 *   Poção de Mana (recupera 30 de mana local).
 * - Slots de cabeça/pernas/botas começam vazios: peças separadas ainda
 *   não existem no gamedata — não inventamos itens para eles.
 */
import { ARMORS, CLASSES, classById, type ArmorData } from "@azure-edge/gamedata";

export type Rarity = "comum" | "raro" | "épico" | "lendário";
export type ItemKind = "armor" | "weapon" | "consumable" | "accessory";
export type EquipSlot = "head" | "chest" | "legs" | "boots" | "weapon" | "accessory";

export const RARITY_LABELS: Record<Rarity, string> = {
  comum: "Comum",
  raro: "Raro",
  épico: "Épico",
  lendário: "Lendário",
};

export const RARITY_COLORS: Record<Rarity, string> = {
  comum: "#b8c4cc",
  raro: "#4a90e2",
  épico: "#a55eea",
  lendário: "#ffb020",
};

export const SLOT_LABELS: Record<EquipSlot, string> = {
  head: "Cabeça",
  chest: "Peito",
  legs: "Pernas",
  boots: "Botas",
  weapon: "Arma",
  accessory: "Acessório",
};

export const SLOT_ORDER: EquipSlot[] = ["head", "chest", "legs", "boots", "weapon", "accessory"];

export interface InventoryItem {
  id: string;
  name: string;
  kind: ItemKind;
  slot: EquipSlot | null;
  rarity: Rarity;
  tier: number;
  minLevel: number;
  weight: number;
  sellPrice: number;
  description: string;
  /** Linhas de atributo (vindas do gamedata; nada inventado). */
  stats: string[];
  setBonus?: string;
  armorId?: string;
  classId?: string;
  colors?: { primary: string; secondary: string; accent: string };
  healHp?: number;
  restoreMana?: number;
  stackable: boolean;
}

export type ItemFilter = "all" | ItemKind;
export type ItemSort = "name" | "rarity" | "level" | "price";

export const ITEM_FILTERS: Array<{ id: ItemFilter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "armor", label: "Armadura" },
  { id: "weapon", label: "Arma" },
  { id: "consumable", label: "Consumível" },
  { id: "accessory", label: "Acessório" },
];

export const ITEM_SORTS: Array<{ id: ItemSort; label: string }> = [
  { id: "rarity", label: "Raridade" },
  { id: "name", label: "Nome (A–Z)" },
  { id: "level", label: "Nível" },
  { id: "price", label: "Preço de venda" },
];

/** Raridade de um conjunto pelo tier (1 = Comum, 2 = Raro, 3 = Épico). */
export function rarityForTier(tier: number): Rarity {
  if (tier >= 3) return "épico";
  if (tier === 2) return "raro";
  return "comum";
}

/** Preço de venda (ouro local) de um conjunto pelo tier. */
export function sellPriceForTier(tier: number): number {
  if (tier >= 3) return 400;
  if (tier === 2) return 120;
  return 25;
}

/** Peso (capacidade local) de um conjunto pelo tier. */
export function weightForTier(tier: number): number {
  if (tier >= 3) return 16;
  if (tier === 2) return 12;
  return 8;
}

function armorStats(a: ArmorData): string[] {
  const out: string[] = [];
  if (a.bonus.maxHp > 0) out.push(`+${a.bonus.maxHp} HP máx.`);
  if (a.bonus.atk) out.push(`+${a.bonus.atk} ATQ`);
  if (a.bonus.def) out.push(`+${a.bonus.def} DEF`);
  if (a.bonus.mana) out.push(`+${a.bonus.mana} mana máx.`);
  if (out.length === 0) out.push("Sem bônus de atributo");
  return out;
}

function armorToItem(a: ArmorData): InventoryItem {
  return {
    id: `armor:${a.id}`,
    name: a.name,
    kind: "armor",
    slot: "chest",
    rarity: rarityForTier(a.tier),
    tier: a.tier,
    minLevel: a.minLevel ?? 1,
    weight: weightForTier(a.tier),
    sellPrice: sellPriceForTier(a.tier),
    description: `Conjunto tier ${a.tier} de ${classById(a.classId)?.name ?? a.classId}${a.material ? ` — ${a.material}` : ""}.`,
    stats: armorStats(a),
    ...(a.setBonus ? { setBonus: a.setBonus } : {}),
    armorId: a.id,
    classId: a.classId,
    colors: a.colors,
    stackable: false,
  };
}

/** Catálogo completo: armaduras do gamedata + arma da classe + exemplos. */
export function buildItemCatalog(): InventoryItem[] {
  const items: InventoryItem[] = ARMORS.map(armorToItem);
  for (const cls of CLASSES) {
    items.push({
      id: `weapon:${cls.id}`,
      name: cls.weapon,
      kind: "weapon",
      slot: "weapon",
      rarity: "comum",
      tier: 1,
      minLevel: 1,
      weight: 5,
      sellPrice: 10,
      description: `Arma inicial do ${cls.name}.`,
      stats: [`ATQ base ${cls.base.atk}`],
      classId: cls.id,
      stackable: false,
    });
  }
  items.push({
    id: "accessory:amuleto_oasis",
    name: "Amuleto do Oásis",
    kind: "accessory",
    slot: "accessory",
    rarity: "comum",
    tier: 1,
    minLevel: 1,
    weight: 1,
    sellPrice: 15,
    description: "Lembrança da Cidade de Serket. Não dá bônus de atributo — só brilha no sol do deserto.",
    stats: ["Sem bônus de atributo"],
    stackable: false,
  });
  items.push({
    id: "consumable:pocao_vida",
    name: "Poção de Vida",
    kind: "consumable",
    slot: null,
    rarity: "comum",
    tier: 1,
    minLevel: 1,
    weight: 1,
    sellPrice: 8,
    description: "Restaura 50 de HP. Efeito local — o servidor ainda não aplica consumíveis.",
    stats: ["Cura 50 de HP (local)"],
    healHp: 50,
    stackable: true,
  });
  items.push({
    id: "consumable:pocao_mana",
    name: "Poção de Mana",
    kind: "consumable",
    slot: null,
    rarity: "comum",
    tier: 1,
    minLevel: 1,
    weight: 1,
    sellPrice: 8,
    description: "Recupera 30 de mana. Efeito local — o servidor ainda não aplica consumíveis.",
    stats: ["Recupera 30 de mana (local)"],
    restoreMana: 30,
    stackable: true,
  });
  return items;
}

export function catalogById(catalog: readonly InventoryItem[]): Map<string, InventoryItem> {
  return new Map(catalog.map((i) => [i.id, i]));
}

// ---------------------------------------------------------------------------
// Estado (localStorage)
// ---------------------------------------------------------------------------

export interface BagEntry {
  itemId: string;
  qty: number;
}

export interface InventoryState {
  gold: number;
  equipped: Record<EquipSlot, string | null>;
  bag: BagEntry[];
}

export const INVENTORY_STORAGE_KEY = "azure-edge:inventory:v1";
export const INVENTORY_CAPACITY = 200;
export const STARTING_GOLD = 150;

/** Bolsa inicial: os 11 conjuntos restantes, 3 poções de vida, 2 de mana, 1 amuleto.
 *  O conjunto tier 1 da classe e a arma começam EQUIPADOS, não na bolsa. */
export function defaultInventoryState(classId: string): InventoryState {
  const equippedChest = ARMORS.find((a) => a.classId === classId && a.tier === 1)?.id ?? "";
  const bag: BagEntry[] = ARMORS.filter((a) => a.id !== equippedChest).map((a) => ({
    itemId: `armor:${a.id}`,
    qty: 1,
  }));
  bag.push({ itemId: "consumable:pocao_vida", qty: 3 });
  bag.push({ itemId: "consumable:pocao_mana", qty: 2 });
  bag.push({ itemId: "accessory:amuleto_oasis", qty: 1 });
  return {
    gold: STARTING_GOLD,
    equipped: {
      head: null,
      chest: `armor:${ARMORS.find((a) => a.classId === classId && a.tier === 1)?.id ?? ""}` || null,
      legs: null,
      boots: null,
      weapon: `weapon:${classId}`,
      accessory: null,
    },
    bag,
  };
}

export function loadInventoryState(classId: string): InventoryState {
  const fallback = defaultInventoryState(classId);
  try {
    const raw = localStorage.getItem(INVENTORY_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const p = parsed as Partial<InventoryState>;
    const catalog = catalogById(buildItemCatalog());
    const equipped: Record<EquipSlot, string | null> = { ...fallback.equipped };
    if (typeof p.equipped === "object" && p.equipped !== null) {
      for (const slot of SLOT_ORDER) {
        const v = (p.equipped as Record<string, unknown>)[slot];
        equipped[slot] = typeof v === "string" && catalog.has(v) ? v : null;
      }
    }
    const bag: BagEntry[] = Array.isArray(p.bag)
      ? (p.bag as BagEntry[]).filter(
          (e) => typeof e?.itemId === "string" && catalog.has(e.itemId) && typeof e.qty === "number" && e.qty > 0,
        )
      : fallback.bag;
    return {
      gold: typeof p.gold === "number" && p.gold >= 0 ? Math.floor(p.gold) : fallback.gold,
      equipped,
      bag: bag.length > 0 ? bag : fallback.bag,
    };
  } catch {
    return fallback;
  }
}

export function saveInventoryState(state: InventoryState): void {
  localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(state));
}

// ---------------------------------------------------------------------------
// Lógica pura
// ---------------------------------------------------------------------------

export function bagCount(state: InventoryState, itemId: string): number {
  return state.bag.find((e) => e.itemId === itemId)?.qty ?? 0;
}

export function isEquipped(state: InventoryState, itemId: string): boolean {
  return SLOT_ORDER.some((s) => state.equipped[s] === itemId);
}

export function totalWeight(state: InventoryState, catalog: Map<string, InventoryItem>): number {
  let total = 0;
  for (const e of state.bag) {
    const item = catalog.get(e.itemId);
    if (item) total += item.weight * e.qty;
  }
  for (const slot of SLOT_ORDER) {
    const id = state.equipped[slot];
    const item = id ? catalog.get(id) : undefined;
    if (item) total += item.weight;
  }
  return total;
}

const RARITY_ORDER: Record<Rarity, number> = { comum: 0, raro: 1, épico: 2, lendário: 3 };

export function filterItems(
  catalog: readonly InventoryItem[],
  filter: ItemFilter,
  query = "",
): InventoryItem[] {
  const q = query.trim().toLowerCase();
  return catalog.filter(
    (i) =>
      (filter === "all" || i.kind === filter) &&
      (q === "" || i.name.toLowerCase().includes(q)),
  );
}

export function sortItems(items: readonly InventoryItem[], sort: ItemSort): InventoryItem[] {
  const out = [...items];
  switch (sort) {
    case "name":
      out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      break;
    case "rarity":
      out.sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || a.name.localeCompare(b.name, "pt-BR"));
      break;
    case "level":
      out.sort((a, b) => a.minLevel - b.minLevel || a.name.localeCompare(b.name, "pt-BR"));
      break;
    case "price":
      out.sort((a, b) => b.sellPrice - a.sellPrice || a.name.localeCompare(b.name, "pt-BR"));
      break;
  }
  return out;
}

/** Itens da bolsa (com quantidade) filtrados/ordenados para a grade. */
export function bagItems(
  state: InventoryState,
  catalog: readonly InventoryItem[],
  filter: ItemFilter,
  sort: ItemSort,
): Array<{ item: InventoryItem; qty: number }> {
  const byId = catalogById(catalog);
  const entries = state.bag
    .map((e) => ({ item: byId.get(e.itemId), qty: e.qty }))
    .filter((e): e is { item: InventoryItem; qty: number } => e.item !== undefined);
  const filtered = filterItems(entries.map((e) => e.item), filter);
  const kept = new Set(filtered.map((i) => i.id));
  const sorted = sortItems(entries.filter((e) => kept.has(e.item.id)).map((e) => e.item), sort);
  const order = new Map(sorted.map((i, idx) => [i.id, idx]));
  return entries
    .filter((e) => kept.has(e.item.id))
    .sort((a, b) => (order.get(a.item.id) ?? 0) - (order.get(b.item.id) ?? 0));
}

export type EquipCheck =
  | { ok: true }
  | { ok: false; reason: string };

export function canEquip(
  item: InventoryItem,
  classId: string,
  level: number,
  state: InventoryState,
): EquipCheck {
  if (item.slot === null) return { ok: false, reason: "Este item não pode ser equipado." };
  if (item.classId && item.classId !== classId) {
    return { ok: false, reason: `Só ${classById(item.classId)?.name ?? item.classId} pode equipar.` };
  }
  if (level < item.minLevel) {
    return { ok: false, reason: `Requer nv ${item.minLevel} (você está no nv ${level}).` };
  }
  if (bagCount(state, item.id) <= 0 && state.equipped[item.slot] !== item.id) {
    return { ok: false, reason: "Você não tem este item na bolsa." };
  }
  return { ok: true };
}

/** Equipa um item da bolsa (o que estava no slot volta para a bolsa). */
export function equipItem(state: InventoryState, item: InventoryItem): InventoryState {
  if (item.slot === null) return state;
  const bag = state.bag
    .map((e) => (e.itemId === item.id ? { ...e, qty: e.qty - 1 } : e))
    .filter((e) => e.qty > 0);
  const previous = state.equipped[item.slot];
  if (previous) bag.push({ itemId: previous, qty: 1 });
  return {
    ...state,
    equipped: { ...state.equipped, [item.slot]: item.id },
    bag,
  };
}

/** Desequipa um slot (o item volta para a bolsa). */
export function unequipSlot(state: InventoryState, slot: EquipSlot): InventoryState {
  const current = state.equipped[slot];
  if (!current) return state;
  return {
    ...state,
    equipped: { ...state.equipped, [slot]: null },
    bag: [...state.bag, { itemId: current, qty: 1 }],
  };
}

export type SellResult =
  | { ok: true; state: InventoryState; gained: number }
  | { ok: false; reason: string };

/** Vende 1 unidade da bolsa por ouro local. Item equipado não pode ser vendido. */
export function sellItem(
  state: InventoryState,
  item: InventoryItem,
): SellResult {
  if (isEquipped(state, item.id)) {
    return { ok: false, reason: "Desequipe o item antes de vender." };
  }
  if (bagCount(state, item.id) <= 0) {
    return { ok: false, reason: "Você não tem este item na bolsa." };
  }
  const bag = state.bag
    .map((e) => (e.itemId === item.id ? { ...e, qty: e.qty - 1 } : e))
    .filter((e) => e.qty > 0);
  return { ok: true, state: { ...state, gold: state.gold + item.sellPrice, bag }, gained: item.sellPrice };
}

export type DiscardResult =
  | { ok: true; state: InventoryState }
  | { ok: false; reason: string };

/** Descarta 1 unidade da bolsa (sem ouro de volta). Item equipado não pode ser descartado. */
export function discardItem(state: InventoryState, item: InventoryItem): DiscardResult {
  if (isEquipped(state, item.id)) {
    return { ok: false, reason: "Desequipe o item antes de descartar." };
  }
  if (bagCount(state, item.id) <= 0) {
    return { ok: false, reason: "Você não tem este item na bolsa." };
  }
  const bag = state.bag
    .map((e) => (e.itemId === item.id ? { ...e, qty: e.qty - 1 } : e))
    .filter((e) => e.qty > 0);
  return { ok: true, state: { ...state, bag } };
}

export type UseResult =
  | { ok: true; state: InventoryState }
  | { ok: false; reason: string };

/** Usa 1 consumível da bolsa (efeito local; o servidor não aplica). */
export function useConsumable(state: InventoryState, item: InventoryItem): UseResult {
  if (item.kind !== "consumable") {
    return { ok: false, reason: "Só consumíveis podem ser usados." };
  }
  if (bagCount(state, item.id) <= 0) {
    return { ok: false, reason: "Você não tem este item na bolsa." };
  }
  const bag = state.bag
    .map((e) => (e.itemId === item.id ? { ...e, qty: e.qty - 1 } : e))
    .filter((e) => e.qty > 0);
  return { ok: true, state: { ...state, bag } };
}

/** Formata ouro: "1.250" (pt-BR, sem símbolo — o rótulo "ouro" fica na UI). */
export function formatGold(gold: number): string {
  return Math.floor(gold).toLocaleString("pt-BR");
}
