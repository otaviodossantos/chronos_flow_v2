-- CreateEnum
CREATE TYPE "PapelUsuario" AS ENUM ('ADMIN', 'MEMBRO');

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "atuando_como_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "bloqueado_em" TIMESTAMP(3),
ADD COLUMN     "papel" "PapelUsuario" NOT NULL DEFAULT 'MEMBRO';

-- CreateTable
CREATE TABLE "convites" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "email" TEXT,
    "criado_por_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usado_em" TIMESTAMP(3),
    "usado_por_id" TEXT,
    "revogado_em" TIMESTAMP(3),

    CONSTRAINT "convites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "convites_token_hash_key" ON "convites"("token_hash");

-- CreateIndex
CREATE INDEX "convites_criado_em_idx" ON "convites"("criado_em");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_atuando_como_id_fkey" FOREIGN KEY ("atuando_como_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites" ADD CONSTRAINT "convites_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites" ADD CONSTRAINT "convites_usado_por_id_fkey" FOREIGN KEY ("usado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A primeira conta com login do servidor vira a administradora.
UPDATE "users" SET "papel" = 'ADMIN'
 WHERE "id" = (SELECT "id" FROM "users" WHERE "password_hash" IS NOT NULL ORDER BY "created_at" ASC LIMIT 1);
