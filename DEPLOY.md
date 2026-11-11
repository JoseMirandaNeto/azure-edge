# Azure Edge — M0 — Deploy / como testar
#
# Two paths, both $0. Path A is the one that validates M0 today;
# Path B is the public link, and it needs one decision from Jose first
# (which GitHub account hosts the repo — there is no git remote yet).

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
