-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dono" BOOLEAN NOT NULL DEFAULT false;


-- A conta 0 (a mais antiga com login) vira a dona: sempre admin e nunca
-- bloqueada. Garante isso mesmo que alguem tenha mexido nela antes.
UPDATE "users" SET "dono" = true, "papel" = 'ADMIN', "bloqueado_em" = NULL
 WHERE "id" = (SELECT "id" FROM "users" WHERE "password_hash" IS NOT NULL ORDER BY "created_at" ASC LIMIT 1);
