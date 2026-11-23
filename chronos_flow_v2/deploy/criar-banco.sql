-- Banco e usuario proprios do Chronos num Postgres ja existente (RDS ou outro).
-- Rode conectado com um usuario que possa criar papeis e bancos, uma vez so:
--   psql ... -v senha='SENHA_DO_BANCO' -f criar-banco.sql
-- Pode rodar de novo: o que ja existe e mantido, e a senha e atualizada.
\set ON_ERROR_STOP on

SELECT 'CREATE ROLE chronos LOGIN CONNECTION LIMIT 10'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chronos')\gexec
ALTER ROLE chronos WITH PASSWORD :'senha';

-- Postgres 16+: para criar um banco em nome de outro papel, quem cria precisa
-- poder assumi-lo (no RDS o usuario mestre nao e superusuario de verdade).
-- Essa permissao extra so dura o necessario; fica a de administrador que o
-- proprio Postgres da a quem cria um papel.
GRANT chronos TO CURRENT_USER;
SELECT 'CREATE DATABASE chronos OWNER chronos'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'chronos')\gexec
REVOKE chronos FROM CURRENT_USER;

-- O Chronos e dono so do proprio banco: nao recebe permissao nenhuma em outros
-- bancos do mesmo servidor. As migrations (prisma migrate deploy) criam as
-- tabelas na primeira subida do container.
