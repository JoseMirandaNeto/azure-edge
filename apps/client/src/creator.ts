import * as THREE from "three";
import { CLASSES, skillById } from "@azure-edge/gamedata";
import {
  applyClassPreset,
  generateGenome,
  generateGenomeFromName,
  HAIR_COLORS,
  HAIR_STYLES,
  IRIS_COLORS,
  OUTFIT_PALETTES,
  OUTFIT_THEMES,
  SKIN_TONES,
  validateGenome,
  type BodyMorphKey,
  type CharacterGenome,
  type ClassId,
  type FaceMorphKey,
} from "@azure-edge/charforge";
import { buildCharacter, disposeCharacter, type CharacterBuild } from "@azure-edge/engine-adapter";

/**
 * Character creator (M2) — class FIRST, then customization (decisão de
 * design do Jose). Picking a class applies its preset (body shape + outfit
 * theme) via applyClassPreset; the player then customizes from there.
 * Genome is saved to localStorage; the game (M4) will sync it to the server.
 */

export const GENOME_STORAGE_KEY = "azure-edge:genome:v1";

/** Approved skill icon per skill id (mix final do Jose; runtime assets em public/assets). */
const SKILL_ICONS: Record<string, string> = {
  espadachim_corte_crescente: "/assets/icon_corte_crescente.png",
  guerreiro_provocacao: "/assets/icon_provocacao.png",
  atirador_disparo_rapido: "/assets/icon_disparo_rapido.png",
  curandeiro_bencao_solar: "/assets/icon_bencao_solar.png",
};

export function loadSavedGenome(): CharacterGenome | null {
  try {
    const raw = localStorage.getItem(GENOME_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return validateGenome(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveGenome(g: CharacterGenome): void {
  localStorage.setItem(GENOME_STORAGE_KEY, JSON.stringify(g));
}

const BODY_SLIDERS: Array<{ key: BodyMorphKey; label: string }> = [
  { key: "height", label: "Altura" },
  { key: "shoulders", label: "Ombros" },
  { key: "bust", label: "Peito" },
  { key: "waist", label: "Cintura" },
  { key: "hips", label: "Quadril" },
  { key: "legLen", label: "Pernas" },
  { key: "armLen", label: "Braços" },
  { key: "muscle", label: "Músculo" },
];
const FACE_SLIDERS: Array<{ key: FaceMorphKey; label: string }> = [
  { key: "eyeSize", label: "Tamanho dos olhos" },
  { key: "eyeTilt", label: "Inclinação dos olhos" },
  { key: "eyeSpacing", label: "Espaço entre os olhos" },
  { key: "noseBridge", label: "Nariz" },
  { key: "lipFull", label: "Lábios" },
  { key: "jaw", label: "Queixo" },
  { key: "cheekbone", label: "Maçãs do rosto" },
  { key: "faceWidth", label: "Largura do rosto" },
];

function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] ?? 123456;
}

export interface CreatorResult {
  genome: CharacterGenome;
  name: string;
}

export class CharacterCreator {
  private draft: CharacterGenome = applyClassPreset(generateGenome(randomSeed()), "espadachim");
  private name = "";
  private renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private build: CharacterBuild | null = null;
  private previewYaw = 0.7;
  private dragging = false;
  private lastX = 0;
  private dirty = true;
  private raf = 0;
  private visible = false;
  private resolve: ((r: CreatorResult) => void) | null = null;
  private controlsBuilt = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly previewEl: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.previewEl.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    this.camera.position.set(0, 1.35, 3.4);
    this.camera.lookAt(0, 0.95, 0);
    this.scene.background = new THREE.Color(0x0b1620);
    this.scene.add(new THREE.HemisphereLight(0xffe9c4, 0x2a3a2f, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2d0, 1.6);
    sun.position.set(2, 4, 2);
    this.scene.add(sun);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 32),
      new THREE.MeshStandardMaterial({ color: 0x1d2f42, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
    });
    window.addEventListener("pointerup", () => {
      this.dragging = false;
    });
    window.addEventListener("pointermove", (e) => {
      if (!this.dragging || !this.visible) return;
      this.previewYaw += (e.clientX - this.lastX) * 0.01;
      this.lastX = e.clientX;
    });
    window.addEventListener("resize", () => this.resize());
  }

  /** Show the creator. Resolves when the player saves and enters the game. */
  show(initial: CharacterGenome | null, name: string): Promise<CreatorResult> {
    this.draft = initial ? structuredClone(initial) : applyClassPreset(generateGenome(randomSeed()), "espadachim");
    this.name = name;
    this.root.classList.remove("hidden");
    this.visible = true;
    this.resize();
    if (!this.controlsBuilt) {
      this.buildControls();
      this.controlsBuilt = true;
    }
    this.syncControls();
    // Class already chosen (reopening) → straight to customization.
    this.showStep(initial ? "custom" : "class");
    this.dirty = true;
    this.loop();
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  private hide(): void {
    this.visible = false;
    this.root.classList.add("hidden");
    cancelAnimationFrame(this.raf);
    if (this.build) {
      this.scene.remove(this.build.group);
      disposeCharacter(this.build);
      this.build = null;
    }
  }

  private resize(): void {
    const w = this.previewEl.clientWidth || 400;
    const h = this.previewEl.clientHeight || 400;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    if (!this.visible) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.dirty && this.build !== null) {
      this.scene.remove(this.build.group);
      disposeCharacter(this.build);
      this.build = null;
    }
    if (this.dirty) {
      this.build = buildCharacter(this.draft, 0);
      this.build.group.rotation.y = this.previewYaw;
      this.scene.add(this.build.group);
      this.dirty = false;
    } else if (this.build) {
      this.build.group.rotation.y = this.previewYaw;
      if (!this.dragging) this.previewYaw += 0.003;
    }
    this.renderer.render(this.scene, this.camera);
  };

  private showStep(step: "class" | "custom"): void {
    const classEl = document.getElementById("creator-step-class");
    const customEl = document.getElementById("creator-step-custom");
    classEl?.classList.toggle("hidden", step !== "class");
    customEl?.classList.toggle("hidden", step !== "custom");
    if (step === "custom") {
      const title = document.getElementById("creator-title");
      const cls = CLASSES.find((c) => c.id === this.draft.classId);
      if (title && cls) title.textContent = `${cls.name} — customize seu personagem`;
    }
  }

  private rebuild(): void {
    this.dirty = true;
  }

  private buildControls(): void {
    // --- Step 1: class cards (from gamedata) ---
    const grid = document.getElementById("class-grid");
    if (grid) {
      for (const cls of CLASSES) {
        const skill = skillById(cls.skillId)?.name ?? "";
        const icon = SKILL_ICONS[cls.skillId];
        const card = document.createElement("button");
        card.className = "class-card";
        card.type = "button";
        card.innerHTML =
          (icon ? `<img class="class-icon" src="${icon}" alt="Ícone de ${skill}" />` : "") +
          `<b>${cls.name}</b><br />` +
          `<span>${cls.role} · ${cls.weapon}</span><br /><span>Skill: ${skill}</span>`;
        card.addEventListener("click", () => {
          this.draft = applyClassPreset(this.draft, cls.id as ClassId);
          this.syncControls();
          this.rebuild();
          this.showStep("custom");
        });
        grid.appendChild(card);
      }
      const note = document.getElementById("class-note");
      if (note) {
        note.textContent =
          "As 4 classes são jogáveis — Guerreiro, Atirador, Curandeiro e Espadachim. A classe escolhida define corpo e roupa iniciais.";
      }
    }

    const $ = (id: string): HTMLElement | null => document.getElementById(id);
    $("creator-back")?.addEventListener("click", () => this.showStep("class"));

    // --- Step 2: name, gender, sliders, swatches ---
    const nameInput = $("creator-name") as HTMLInputElement | null;
    if (nameInput) {
      nameInput.value = this.name;
      nameInput.addEventListener("change", () => {
        this.name = nameInput.value.trim();
        if (this.name) {
          // The name seeds the look (deterministic): same name, same base.
          this.draft = applyClassPreset(generateGenomeFromName(this.name), this.draft.classId);
          this.syncControls();
          this.rebuild();
        }
      });
    }
    const genderF = $("creator-gender-f");
    const genderM = $("creator-gender-m");
    genderF?.addEventListener("click", () => {
      this.draft.gender = "f";
      this.syncControls();
      this.rebuild();
    });
    genderM?.addEventListener("click", () => {
      this.draft.gender = "m";
      this.syncControls();
      this.rebuild();
    });

    const slidersEl = $("creator-sliders");
    if (slidersEl) {
      const addGroup = (title: string, items: Array<{ key: string; label: string }>, section: "body" | "face"): void => {
        const h = document.createElement("h3");
        h.textContent = title;
        slidersEl.appendChild(h);
        for (const item of items) {
          const row = document.createElement("label");
          row.className = "slider-row";
          row.innerHTML = `<span>${item.label}</span><input type="range" min="-1" max="1" step="0.05" />`;
          const input = row.querySelector("input") as HTMLInputElement;
          input.dataset.section = section;
          input.dataset.key = item.key;
          input.addEventListener("input", () => {
            const v = Number(input.value);
            if (section === "body") this.draft.body[item.key as BodyMorphKey] = v;
            else this.draft.face[item.key as FaceMorphKey] = v;
            this.rebuild();
          });
          slidersEl.appendChild(row);
        }
      };
      addGroup("Corpo", BODY_SLIDERS, "body");
      addGroup("Rosto", FACE_SLIDERS, "face");
    }

    const swatchGroup = (id: string, colors: readonly string[], apply: (c: string) => void): void => {
      const el = document.getElementById(id);
      if (!el) return;
      for (const c of colors) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "swatch";
        b.style.background = c;
        b.title = c;
        b.addEventListener("click", () => {
          apply(c);
          this.rebuild();
        });
        el.appendChild(b);
      }
    };
    swatchGroup("creator-skin", SKIN_TONES, (c) => {
      this.draft.skin.tone = c;
    });
    swatchGroup("creator-iris", IRIS_COLORS, (c) => {
      this.draft.eyes.iris = c;
    });
    swatchGroup("creator-haircolor", HAIR_COLORS, (c) => {
      this.draft.hair.color = c;
    });

    const optionGroup = (id: string, options: readonly string[], labels: Record<string, string>, apply: (o: string) => void): void => {
      const el = document.getElementById(id);
      if (!el) return;
      for (const o of options) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "opt";
        b.textContent = labels[o] ?? o;
        b.dataset.value = o;
        b.addEventListener("click", () => {
          apply(o);
          this.syncControls();
          this.rebuild();
        });
        el.appendChild(b);
      }
    };
    const HAIR_LABELS: Record<string, string> = {
      longBraid_03: "Trança longa",
      ponytail_01: "Rabo de cavalo",
      short_02: "Curto",
      bun_04: "Coque",
      longLoose_05: "Longo solto",
      topknot_06: "Topete",
    };
    const OUTFIT_LABELS: Record<string, string> = {
      hanbok_armor: "Armadura hanbok",
      cheongsam_blade: "Cheongsam lâmina",
      ninja_lite: "Ninja leve",
      noble_robe: "Manto nobre",
      desert_nomad: "Nômade do deserto",
      oasis_guard: "Guarda do oásis",
    };
    optionGroup("creator-hair", HAIR_STYLES, HAIR_LABELS, (o) => {
      this.draft.hair.style = o as CharacterGenome["hair"]["style"];
    });
    optionGroup("creator-outfit", OUTFIT_THEMES, OUTFIT_LABELS, (o) => {
      const theme = o as CharacterGenome["outfit"]["theme"];
      this.draft.outfit = { theme, palette: OUTFIT_PALETTES[theme] };
    });

    $("creator-random")?.addEventListener("click", () => {
      this.draft = applyClassPreset(generateGenome(randomSeed()), this.draft.classId);
      this.syncControls();
      this.rebuild();
    });
    $("creator-export")?.addEventListener("click", () => void this.exportGLB());
    $("creator-enter")?.addEventListener("click", () => {
      if (!validateGenome(this.draft)) return;
      saveGenome(this.draft);
      const result: CreatorResult = { genome: this.draft, name: this.name };
      this.hide();
      this.resolve?.(result);
      this.resolve = null;
    });
  }

  private async exportGLB(): Promise<void> {
    if (!this.build) return;
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    const exporter = new GLTFExporter();
    const glb = (await exporter.parseAsync(this.build.group, { binary: true })) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `azure-edge-${this.draft.classId}-${this.draft.seed}.glb`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Push the draft values into the controls (after class pick / reroll). */
  private syncControls(): void {
    const $ = (id: string): HTMLElement | null => document.getElementById(id);
    const nameInput = $("creator-name") as HTMLInputElement | null;
    if (nameInput && document.activeElement !== nameInput) nameInput.value = this.name;
    for (const input of document.querySelectorAll<HTMLInputElement>("#creator-sliders input[type=range]")) {
      const section = input.dataset.section;
      const key = input.dataset.key;
      if (!section || !key) continue;
      input.value = String(
        section === "body" ? this.draft.body[key as BodyMorphKey] : this.draft.face[key as FaceMorphKey],
      );
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>("#creator-hair .opt")) {
      b.classList.toggle("sel", b.dataset.value === this.draft.hair.style);
    }
    for (const b of document.querySelectorAll<HTMLButtonElement>("#creator-outfit .opt")) {
      b.classList.toggle("sel", b.dataset.value === this.draft.outfit.theme);
    }
    $("creator-gender-f")?.classList.toggle("sel", this.draft.gender === "f");
    $("creator-gender-m")?.classList.toggle("sel", this.draft.gender === "m");
  }
}
