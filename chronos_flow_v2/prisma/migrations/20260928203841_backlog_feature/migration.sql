-- CreateEnum
CREATE TYPE "BacklogStatus" AS ENUM ('INBOX', 'PLANNING', 'CONVERTED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "nodes" ADD COLUMN     "all_day" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "gemini_api_key" TEXT,
ADD COLUMN     "gemini_model" TEXT NOT NULL DEFAULT 'gemini-2.5-flash';

-- CreateTable
CREATE TABLE "backlog_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "space_id" TEXT,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" "BacklogStatus" NOT NULL DEFAULT 'INBOX',
    "position" INTEGER NOT NULL DEFAULT 0,
    "target_date" TIMESTAMP(3),
    "context" TEXT,
    "ai_plan" JSONB,
    "ai_model" TEXT,
    "ai_planned_at" TIMESTAMP(3),
    "converted_node_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backlog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backlog_roles" (
    "id" TEXT NOT NULL,
    "backlog_item_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "hours_per_week" INTEGER,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "member_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backlog_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backlog_items_user_id_status_position_idx" ON "backlog_items"("user_id", "status", "position");

-- CreateIndex
CREATE INDEX "backlog_roles_backlog_item_id_position_idx" ON "backlog_roles"("backlog_item_id", "position");

-- AddForeignKey
ALTER TABLE "backlog_items" ADD CONSTRAINT "backlog_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backlog_items" ADD CONSTRAINT "backlog_items_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backlog_roles" ADD CONSTRAINT "backlog_roles_backlog_item_id_fkey" FOREIGN KEY ("backlog_item_id") REFERENCES "backlog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backlog_roles" ADD CONSTRAINT "backlog_roles_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
