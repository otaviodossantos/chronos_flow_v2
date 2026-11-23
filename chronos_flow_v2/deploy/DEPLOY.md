# Deploy em servidor

O Chronos sobe como um container so: a mesma porta serve a API e a tela. Ele
precisa de um Postgres (16+; testado no 18, inclusive RDS) e de HTTPS na
frente. O login exige HTTPS, porque o cookie de sessao e `Secure` atras de
proxy.

```
navegador ──HTTPS──▶ proxy / tunel / load balancer ──▶ chronos:3101 ──▶ Postgres (banco "chronos")
```

## 1. Banco

Num Postgres existente, com um usuario que possa criar papeis e bancos (no RDS,
o usuario mestre):

```bash
psql "host=HOST_DO_BANCO user=USUARIO_ADMIN dbname=postgres sslmode=require" \
  -v senha='SENHA_DO_BANCO' -f deploy/criar-banco.sql
```

Cria o usuario `chronos` e o banco `chronos`, dono so de si mesmo. Pode rodar de
novo sem estragar nada. As tabelas nascem na primeira subida do container
(`prisma migrate deploy`).

## 2. Imagem

```bash
docker build -t chronos-flow:latest .            # da pasta chronos_flow_v2/
# ou para outra arquitetura:  docker build --platform linux/arm64 ...
```

Para levar a um servidor, envie a um registro (ECR, GHCR, Docker Hub) e
aponte `CHRONOS_IMAGEM` no `.env` para ele.

Com Podman, use `--format docker` no build: o formato OCI padrao descarta o
`HEALTHCHECK` (o `compose.yaml` tem o seu proprio, por garantia).

## 3. Subir

```bash
cp deploy/compose.yaml deploy/env.producao.exemplo /caminho/no/servidor/
cd /caminho/no/servidor && mv env.producao.exemplo .env   # e preencha
docker compose --env-file .env up -d
docker compose logs -f   # migrations e "Chronos Flow v2 API em ..."
```

`CHRONOS_CONVITE` e obrigatorio em servidor acessado pela rede: sem ele,
ninguem cria a primeira conta de fora (o servidor avisa no log).

## 4. HTTPS

Aponte o proxy para `http://127.0.0.1:3101`. Qualquer um serve:

- **Caddy:** `chronos.seudominio.com { reverse_proxy 127.0.0.1:3101 }`
  (certificado automatico);
- **Cloudflare Tunnel:** hostname publico → `http://localhost:3101` (ou
  `http://chronos:3101` se o `cloudflared` estiver na mesma rede Docker; nesse
  caso, troque `ports` por essa rede no `compose.yaml`);
- **Load balancer** (ALB etc.): health check em `/api/health`, que responde
  sem login.

Nao ha mais atalho de "conexao local": atras de proxy, todo acesso exige login.

## 5. Primeira conta e MCP

1. Abra o endereco, clique em "Criar conta" e use o codigo de convite.
2. Em Configuracoes > Conta e acesso, crie um token de API e configure o MCP:

```bash
claude mcp add chronos -s user \
  -e CHRONOS_API=https://chronos.seudominio.com/api \
  -e CHRONOS_TOKEN=chr_... \
  -- npx tsx /caminho/para/chronos_flow_v2/mcp/server.ts
```

Quem mais tiver o codigo de convite cria a propria conta e ve so os proprios
projetos. O token do MCP le e escreve projetos, mas nao mexe na conta (senha,
tokens, apagar, transferir); trocar a senha revoga os tokens.

## Atualizar

Gere e envie a imagem nova, depois:

```bash
docker compose --env-file .env pull && docker compose --env-file .env up -d
```

As migrations novas rodam sozinhas na subida.

## Cuidados

- **Nunca rode `npm run prisma:seed` contra o banco de producao**: o seed apaga
  tudo (ele se recusa quando ha contas, a menos que `SEED_APAGAR_CONTAS=sim`).
- **Backup** e com o Postgres: snapshots do RDS, `pg_dump` agendado etc.
- **Esqueceu a senha?** Nao ha e-mail de recuperacao; com acesso ao servidor:

  ```bash
  echo 'senha-nova' | docker exec -i chronos node dist-server/server/scripts/senha.js pessoa@exemplo.com
  ```
