import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INVENTORY_CAPACITY,
  bagItems,
  buildItemCatalog,
  canEquip,
  catalogById,
  defaultInventoryState,
  discardItem,
  equipItem,
  filterItems,
  formatGold,
  isEquipped,
  loadInventoryState,
  rarityForTier,
  sellItem,
  sellPriceForTier,
  sortItems,
  totalWeight,
  unequipSlot,
  useConsumable,
  type InventoryState,
} from "./inventory.js";

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

const catalog = buildItemCatalog();
const byId = catalogById(catalog);
const armorEspTier1 = byId.get("armor:espadachim_iniciante")!;
const armorEspTier3 = byId.get("armor:espadachim_dourada")!;
const armorGuerreiro = byId.get("armor:guerreiro_iniciante")!;
const pocaoVida = byId.get("consumable:pocao_vida")!;
const pocaoMana = byId.get("consumable:pocao_mana")!;
const amuleto = byId.get("accessory:amuleto_oasis")!;

function freshState(): InventoryState {
  return defaultInventoryState("espadachim");
}

describe("catálogo", () => {
  it("tem os 12 conjuntos + armas + acessório + 2 consumíveis", () => {
    expect(catalog.filter((i) => i.kind === "armor")).toHaveLength(12);
    expect(catalog.filter((i) => i.kind === "weapon")).toHaveLength(4);
    expect(catalog.filter((i) => i.kind === "consumable")).toHaveLength(2);
    expect(catalog.filter((i) => i.kind === "accessory")).toHaveLength(1);
  });

  it("raridade e preço seguem o tier (1 comum/25, 2 raro/120, 3 épico/400)", () => {
    expect(rarityForTier(1)).toBe("comum");
    expect(rarityForTier(2)).toBe("raro");
    expect(rarityForTier(3)).toBe("épico");
    expect(sellPriceForTier(1)).toBe(25);
    expect(sellPriceForTier(2)).toBe(120);
    expect(sellPriceForTier(3)).toBe(400);
    expect(armorEspTier1.rarity).toBe("comum");
    expect(armorEspTier3.rarity).toBe("épico");
    expect(armorEspTier3.minLevel).toBe(16);
  });

  it("bolsa inicial: 12 conjuntos, poções e amuleto; peito e arma equipados", () => {
    const s = freshState();
    expect(s.gold).toBe(150);
    expect(s.bag).toHaveLength(14);
    expect(s.equipped.chest).toBe("armor:espadachim_iniciante");
    expect(s.equipped.weapon).toBe("weapon:espadachim");
    expect(s.equipped.head).toBeNull();
    expect(s.equipped.legs).toBeNull();
    expect(s.equipped.boots).toBeNull();
    expect(isEquipped(s, "armor:espadachim_iniciante")).toBe(true);
  });

  it("peso total cabe na capacidade inicial", () => {
    expect(totalWeight(freshState(), byId)).toBeLessThanOrEqual(INVENTORY_CAPACITY);
    expect(totalWeight(freshState(), byId)).toBeGreaterThan(0);
  });
});

describe("filtro e ordenação", () => {
  it("filterItems separa por tipo e busca por nome", () => {
    expect(filterItems(catalog, "armor")).toHaveLength(12);
    expect(filterItems(catalog, "consumable").map((i) => i.name)).toEqual([
      "Poção de Vida",
      "Poção de Mana",
    ]);
    expect(filterItems(catalog, "all", "carmesim").map((i) => i.id)).toEqual([
      "armor:espadachim_carmesim",
    ]);
    expect(filterItems(catalog, "weapon", "espada")).toHaveLength(1);
  });

  it("sortItems: raridade (épico primeiro), nome, nível e preço", () => {
    const byRarity = sortItems(catalog, "rarity");
    expect(byRarity[0]?.rarity).toBe("épico");
    expect(byRarity[byRarity.length - 1]?.rarity).toBe("comum");
    const byName = sortItems(catalog, "name");
    const names = byName.map((i) => i.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "pt-BR")));
    const byLevel = sortItems(catalog, "level");
    expect(byLevel[0]?.minLevel).toBe(1);
    expect(byLevel[byLevel.length - 1]?.minLevel).toBe(16);
    const byPrice = sortItems(catalog, "price");
    expect(byPrice[0]?.sellPrice).toBe(400);
  });

  it("bagItems respeita filtro + ordenação e mantém quantidades", () => {
    const s = freshState();
    const all = bagItems(s, catalog, "all", "rarity");
    expect(all[0]?.item.rarity).toBe("épico");
    expect(all.find((e) => e.item.id === "consumable:pocao_vida")?.qty).toBe(3);
    const consumables = bagItems(s, catalog, "consumable", "name");
    expect(consumables).toHaveLength(2);
    expect(consumables[0]?.item.name).toBe("Poção de Mana");
  });
});

describe("equipar / desequipar", () => {
  it("canEquip recusa outra classe, nível insuficiente e item fora da bolsa", () => {
    const s = freshState();
    expect(canEquip(armorGuerreiro, "espadachim", 1, s)).toEqual({
      ok: false,
      reason: "Só Guerreiro pode equipar.",
    });
    expect(canEquip(armorEspTier3, "espadachim", 1, s)).toEqual({
      ok: false,
      reason: "Requer nv 16 (você está no nv 1).",
    });
    expect(canEquip(pocaoVida, "espadachim", 1, s).ok).toBe(false);
    expect(canEquip(armorEspTier1, "espadachim", 1, s)).toEqual({ ok: true });
    expect(canEquip(armorEspTier3, "espadachim", 16, s)).toEqual({ ok: true });
  });

  it("equipItem troca o peito e devolve o anterior à bolsa", () => {
    const s = freshState();
    const next = equipItem(s, byId.get("armor:espadachim_carmesim")!);
    expect(next.equipped.chest).toBe("armor:espadachim_carmesim");
    expect(next.bag.find((e) => e.itemId === "armor:espadachim_iniciante")?.qty).toBe(1);
    expect(next.bag.find((e) => e.itemId === "armor:espadachim_carmesim")).toBeUndefined();
  });

  it("unequipSlot devolve o item à bolsa e limpa o slot", () => {
    const s = freshState();
    const next = unequipSlot(s, "chest");
    expect(next.equipped.chest).toBeNull();
    expect(next.bag.filter((e) => e.itemId === "armor:espadachim_iniciante")).toHaveLength(1);
    expect(unequipSlot(next, "chest")).toEqual(next);
  });
});

describe("vender / descartar / usar", () => {
  it("sellItem soma o ouro local e remove 1 unidade da bolsa", () => {
    const s = freshState();
    const res = sellItem(s, armorEspTier1);
    // O tier 1 está equipado no estado inicial: vender é recusado.
    expect(res.ok).toBe(false);
    const unequipped = unequipSlot(s, "chest");
    const sold = sellItem(unequipped, armorEspTier1);
    expect(sold.ok).toBe(true);
    if (sold.ok) {
      expect(sold.state.gold).toBe(150 + 25);
      expect(sold.gained).toBe(25);
      expect(sold.state.bag.find((e) => e.itemId === armorEspTier1.id)).toBeUndefined();
    }
  });

  it("sellItem de poção empilhada tira só 1 unidade", () => {
    const s = freshState();
    const res = sellItem(s, pocaoVida);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.gold).toBe(158);
      expect(res.state.bag.find((e) => e.itemId === pocaoVida.id)?.qty).toBe(2);
    }
  });

  it("discardItem remove sem dar ouro; equipado é recusado", () => {
    const s = freshState();
    expect(discardItem(s, armorEspTier1).ok).toBe(false);
    const res = discardItem(s, amuleto);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.gold).toBe(150);
      expect(res.state.bag.find((e) => e.itemId === amuleto.id)).toBeUndefined();
    }
  });

  it("useConsumable consome 1 poção; item não-consumível é recusado", () => {
    const s = freshState();
    const res = useConsumable(s, pocaoMana);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.bag.find((e) => e.itemId === pocaoMana.id)?.qty).toBe(1);
    }
    expect(useConsumable(s, armorEspTier1).ok).toBe(false);
    expect(useConsumable(s, pocaoVida).ok).toBe(true);
  });
});

describe("persistência local", () => {
  it("loadInventoryState volta ao padrão com JSON corrompido", () => {
    localStorage.setItem("azure-edge:inventory:v1", "{não-json");
    expect(loadInventoryState("espadachim").gold).toBe(150);
  });

  it("formatGold usa separador pt-BR", () => {
    expect(formatGold(150)).toBe("150");
    expect(formatGold(1250)).toBe("1.250");
  });
});
