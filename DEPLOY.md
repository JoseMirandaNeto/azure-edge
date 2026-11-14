# Azure Edge — M0 — Deploy / como testar
#
# Two paths, both $0. Path A is the one that validates M0 today;
# Path B is the public link, and it needs one decision from Jose first
# (which GitHub account hosts the repo — there is no git remote yet).
#
# Estado em 2026-11-14 (verificado de um checkout limpo do HEAD c1bb48d):
# - `pnpm install` + `pnpm build` 8/8 OK, servidor sobe, GET /healthz
#   -> 200 em ~7 ms, smoke M1 (2 clients WS) PASS.
# - Dois bloqueios de deploy de clone limpo foram CORRIGIDOS no repo:
#   (1) pnpm-lock.yaml dessincronizado de package.json (@types/node) —
#   `pnpm install --frozen-lockfile` (o que o Render roda) falhava.
#   (2) tsconfig.tsbuildinfo versionados faziam o `tsc -p` (composite)
#   pular a emissão de dist/ no clone limpo — agora gitignorados.
# - ATENÇÃO: a working tree atual NÃO sobe — há um refactor em andamento
#   (classes Guerreiro/Curandeiro + novas skills/armas/dungeons) e o
#   gamedata falha na validação de schema (`skills.json failed schema
#   validation`). O deploy deve sair do HEAD commitado, não da working
#   tree, até o refactor ficar verde (`pnpm test` passando).

## Comparativo de hosts gratuitos (verificado nov/2026)
#
# O server-game precisa de processo Node LONGO (WebSocket 20 Hz, estado
# em memória) — hosts serverless (Vercel/Netlify Functions/Cloudflare
# Workers) NÃO servem para ele, só para o client estático.
#
# | Host (server-game) | Custo | Sleep | RAM | WebSocket | Cartão? | Veredito |
# |--------------------|-------|-------|-----|-----------|---------|----------|
# | Render free | $0 | sim, 15 min idle (~1 min p/ acordar) | 512 MB | sim | não | RECOMENDADO (rota atual) |
# | Northflank Sandbox | $0 | NÃO (always-on) | até $20/mês de recursos | sim | conflitante* | Plano B se o sleep incomodar |
# | Fly.io | sem free p/ contas novas (trial $1, 7 dias) | n/a | 256 MB por $2,19/30d | sim | sim, após trial | descartado ($0 impossível) |
# | Railway | trial $5 (único), depois $1/mês de crédito | não | uso medido | sim | não | descartado (não é $0 permanente) |
# | Softamera | NÃO PUBLICADO | desconhecido | desconhecido | desconhecido | desconhecido | NÃO AVALIÁVEL — ver abaixo |
# | Client estático (Netlify Drop) | $0 (300 créditos/mês) | não (estático) | n/a | n/a | não | RECOMENDADO p/ o client |
#
# * Northflank: a pricing page diz "No card needed", mas os billing docs
#   dizem que é preciso cadastrar forma de pagamento p/ criar recursos, e
#   verificação de terceiros (out/2026) confirma cartão exigido. Ou seja:
#   free e always-on, mas provavelmente pede cartão p/ verificar. Só vale
#   testar se o Jose topar cadastrar o cartão (sem cobrança no Sandbox).
#   Limites Sandbox: 2 serviços, 2 jobs, 1 banco, até $20/mês de recursos.
#
# Softamera (console.apps.softamera.com) — veredito:
# - O que é: PaaS novo, MCP-first ("Cloud infrastructure made easy").
#   Console com projetos, serviços web/api/worker, Postgres 18, Redis 8,
#   volumes, subdomínios *.apps.softamera.com. O deploy é feito pela IA
#   assistente via MCP (https://mcp.apps.softamera.com/mcp) — a IA cria o
#   projeto, bancos e deploy, e o usuário acompanha no dashboard.
# - O que NÃO dá p/ saber sem criar conta (e não foi criado nada):
#   não há página de preços pública nem documentação de plano gratuito
#   encontrada (buscas só retornam a própria landing page; os resultados
#   de "pricing" são da Softr, empresa DIFERENTE — não confundir).
#   Desconhecidos: preço, free tier, sleep, RAM, suporte a WebSocket,
#   deploy via GitHub vs só via MCP, região, e o que o signup pede
#   (email? OAuth? cartão? verificação?).
# - Veredito: NÃO RECOMENDADO como rota principal agora — é uma incógnita
#   total de preço e limites, e o deploy via MCP não é reproduzível pelo
#   nosso fluxo (render.yaml/GitHub). Pode ser testado depois pelo Jose,
#   criando a conta ele mesmo, como experimento — sem migrar nada antes
#   de confirmar free tier + WebSocket + sem sleep.

## Path A — Testar no seu PC (recomendado para validar o M0)
#
# 1. Baixe o zip do projeto (código-fonte, sem node_modules) e descompacte.
# 2. Instale Node 20+ e pnpm 9 (`npm i -g pnpm@9`).
# 3. `pnpm install && pnpm build && pnpm test`
# 4. Terminal 1: `pnpm --filter @azure-edge/server-game start` (porta 3001)
#    Terminal 2: `pnpm --filter @azure-edge/client dev`
# 5. Abra http://127.0.0.1:5173/ em duas abas, uma com `?latency=100`,
#    mova com WASD, aperte F3 e anote o FPS.
#
# Isso é o que o M0 precisa para ser considerado 100% validado
# visualmente — o FPS no navegador nunca foi medido aqui.

## Path B — Link público jogável (grátis, com ressalvas)
#
# Pré-requisito: o repo precisa estar no GitHub (hoje não há remote).
# Sem isso o Render não tem de onde puxar o código.
#
# 1. Servidor de jogo — Render (free web service)
#    - New > Web Service > conecte o repo GitHub.
#    - Ou use o Blueprint: `render.yaml` na raiz (build + start + /healthz).
#    - O servidor já responde `GET /healthz` com 200 (para health check
#      e keep-alive) e aceita WebSocket na mesma porta ($PORT do Render).
#    - Anote a URL: `https://azure-edge-server-game.onrender.com`
#      (o WebSocket é `wss://azure-edge-server-game.onrender.com`).
#    - Ressalvas do plano free (verificado nov/2026): dorme após 15 min
#      sem tráfego e leva ~1 min para acordar no primeiro acesso;
#      750 h grátis/mês por workspace; 512 MB RAM.
#
# 2. Client — Netlify Drop (o mais rápido, sem conta)
#    - `pnpm --filter @azure-edge/client build` e arraste a pasta
#      `apps/client/dist` para https://app.netlify.com/drop
#    - Você recebe uma URL https://…netlify.app em ~30 s.
#    - Sem conta, o site fica protegido por senha temporária até ser
#      reivindicado — crie uma conta grátis na Netlify e reivindique
#      para o link ficar público e permanente (plano free: 300 créditos/mês).
#    - Abra o jogo com o servidor explícito (a página é https, então
#      o WebSocket tem que ser wss):
#        https://<seu-site>.netlify.app/?server=wss://azure-edge-server-game.onrender.com
#    - Alternativa sem `?server=`: rebuild do client com a variável
#      `VITE_GAME_SERVER_URL=wss://…onrender.com` (ver .env.example).
#      Em página https o client já usa wss:// por padrão.
#
# 3. Teste com 2 abas no link público, como no Path A, e me diga o FPS.
#
# 4. Verificação pós-deploy (daqui da VM, sem conta em nada):
#      node apps/tools/check-deploy.mjs --server https://azure-edge-server-game.onrender.com --client https://<site>.netlify.app --ws
#    Checa /healthz, o client e o handshake WebSocket. Exit 0 = tudo OK.

## Keep-alive — manter o Render free acordado
#
# Sem tráfego o serviço dorme em 15 min; o primeiro jogador espera ~1 min
# (o client precisa tolerar/reconectar — hoje ele já reconecta).
# Um ping a cada 10 min em /healthz impede o sleep.
#
# Opção A (recomendada): UptimeRobot gratuito — conta grátis, monitor
# HTTP(s) em https://<servico>.onrender.com/healthz, intervalo 5 min.
# Free (nov/2026): 50 monitores, 5 min, sem cartão, com alerta por email.
# Não precisa de máquina ligada nem de cron.
#
# Opção B: cron — ver deploy/keep-alive.cron (modelo + linha pronta).
# O script apps/tools/keep-alive.mjs faz um ping e sai (exit 0 = ok);
# rode-o a cada 10 min via cron do Muse ou de um servidor sempre ligado:
#   node apps/tools/keep-alive.mjs --url https://<servico>.onrender.com
#   node apps/tools/keep-alive.mjs --loop --interval-min 10  # daemon local
#
# ORÇAMENTO DE HORAS: um serviço sempre acordado consome ~720 h/mês das
# 750 h grátis do workspace. Com UM serviço, cabe. NÃO faça keep-alive de
# 2+ serviços free no mesmo workspace — as horas acabam e o Render
# suspende todos os serviços free até o mês seguinte. (Se um dia houver
# server-api junto, ele dorme ou vai p/ outro workspace/conta.)
#
# Rota futura se o sleep virar problema: Northflank Sandbox (always-on,
# free, 2 serviços — ver tabela acima; pode pedir cartão p/ verificar) ou
# Render pago ($7/mês, 512 MB, sem sleep). Fly.io/Railway não são $0.
