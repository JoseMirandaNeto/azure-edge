# CHARACTER PIPELINE — "CharForge"

## Objetivo
Gerar personagens adultos de estética asiática, anime semi-realista, únicos e determinísticos por seed, com ótima performance no browser, e exportáveis para glTF (para clients nativos futuros).

## Abordagem recomendada (híbrida — melhor relação qualidade/custo)
Malhas "do zero" por código tendem a ficar feias. Use:
1. **Base mesh autoral** (ou licenciada) com topologia limpa e UV padrão: corpo masculino e feminino (mesmo esqueleto humanoide, 65 ossos), cabeça com rig facial por morphs.
2. **Morph targets (blendshapes)** para corpo (altura, ombros, busto, cintura, quadril, pernas, braços) e rosto (olhos, nariz, boca, queixo, maçãs, sobrancelhas). Valores -1..1 gerados por seed com distribuição e limites estéticos (ver abaixo).
3. **Kit modular** de cabelos (cards/ribbons), roupas, armaduras, acessórios; cada peça tem máscaras de "corpo oculto" p/ evitar clipping; slots e tags de compatibilidade.
4. **Geração procedural de conteúdo** em cima do kit: gramática de figurino (tema + paleta + peças + padrões), curvas Bézier/ribbons para cabelo e fitas, texturas procedurais por TSL/Canvas (padrões de bordado, nuvens, ondas, dragões estilizados) baked em atlas.
5. **Bake offline (tools)** de variantes populares + **runtime** para o resto: aplicar morphs, merge de geometrias estáticas por personagem (≤6 draw calls: corpo+rosto, cabelo, roupa A, roupa B, acessórios, armas).

## Parâmetros (Character Genome — JSON versionado)
```json
{ "v":1, "seed":123456, "gender":"f|m|n", "bodyType":0.0-1.0,
  "morphs":{"height":0.2,"shoulders":-0.1,"bust":0.5,"waist":-0.4,"hips":0.4,"legLen":0.3},
  "face":{"eyeSize":0.6,"eyeTilt":0.2,"noseBridge":-0.2,"lipFull":0.3,"jaw":-0.3,"preset":"soft|sharp|mature|youthful_adult"},
  "skin":{"tone":"#F2D6C2","blush":0.2,"sss":0.4},
  "eyes":{"iris":"#3B6EA8","pupil":0.5,"highlightStyle":2},
  "hair":{"style":"longBraid_03","color":"#1B1B2F","tips":"#6C8CFF","physics":0.8},
  "outfit":{"theme":"hanbok_armor|cheongsam_blade|ninja_lite|noble_robe","palette":["#0B3954","#C8102E","#D4AF37"],"coverage":0.0-1.0,"parts":{"top":"...","bottom":"...","shoes":"..."}},
  "makeup":{"lip":"#C2185B","eyeliner":0.6}, "marks":["beauty_mark_left"] }
```
- `coverage` define a variação do figurino (ex.: decote/fenda/barriga à mostra) dentro do **limite de classificação**: sem nudez, sem mamilos/genitais modelados, roupa íntima visível apenas como traje de verão/praia estilizado em evento, nunca no mundo base.
- **Restrições de adulto**: proporção facial/corporal mínima de adulto (clamp nos morphs `youthful_adult`); lore ≥18; proibido preset infantil.
- Sorteio por seed: PRNG determinístico + "beauty prior" (distribuições gaussianas truncadas nos morphs, evitando combinações estranhas) + validador de clipping.

## Shading (TSL) — anime semi-realista
- **Pele**: albedo + gradiente ramp 3 tons suave, SSS falso (wrap diffuse + tint avermelhado nas bordas), blush mask, specular suave. 
- **Olhos**: malha de íris com paralaxe, highlights fixos em espaço de tela (estilo anime), sombras de cílios.
- **Cabelo**: Kajiya-Kay anisotrópico + ramp, mechas em cards alfa-teste/alpha-to-coverage (sem blending caro), física leve (verlet em ossos, 6-12 cadeias).
- **Roupa**: tecido (sheen leve), normal maps detalhados, metais com env map pré-filtrado.
- **Outline**: inverted hull (espessura por distância) no LOD0/1; pós-processo de bordas em Ultra.
- **Pós**: tone mapping ACES/AgX, bloom suave, SSAO barato (opcional), FXAA/TAA.
- Luz: 1 direcional + hemisférica + sombras em cascata (2 cascatas), luz de contorno (rim) por personagem.

## Animação
- Esqueleto humanoide único → retarget de qualquer animação (mocap licenciado/IA/keyframe). Ações-chave por classe: idle, andar/correr, esquiva, 3-4 golpes, 8 skills, guarda, agarrar, stagger, knockdown, morte, montaria, emotes.
- Peso e "juice": anticipation, smear frames (geometria alongada opcional), hit-stop, trails de arma (ribbon mesh), poeira.
- Springs/jiggle sutil para cabelo, saias, fitas, cabos (verlet). Sem física "exagerada".
- Facial: morphs (piscar, falar visemas simples, expressões de dano/ataque).

## LODs e custo
LOD0 40–60k tris / LOD1 20k / LOD2 8k / LOD3 2k / impostor. Gerar LODs com meshoptimizer (simplify) no bake. Texturas: atlas 2048 (corpo+roupa), 1024 (cabelo), KTX2.

## Entregáveis do pacote `charforge`
- `genome.ts` (schema Zod + versionamento), `rng.ts`, `generate(seed, opts)`, `applyMorphs`, `assembleOutfit`, `bakeAtlas`, `exportGLB` (CLI), `validate` (clipping, tris, ossos, adulto).
- Tela de criação: sliders + botão "Sortear" + "Bloquear campo" + salvar genome (≤1 KB) no servidor.
- Testes: mesma seed → mesmo hash do genome e do resultado; 1000 seeds sem NaN/clipping crítico.

## Fontes de base mesh (decisão em ADR)
(a) modelar/encomendar base própria (melhor), (b) gerar base via ferramentas (MakeHuman/VRoid/Blender + licença verificada), (c) assets licenciados. Verifique SEMPRE a licença para uso comercial e redistribuição no browser.
