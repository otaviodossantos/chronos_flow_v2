-- CreateTable
CREATE TABLE "task_templates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "estimated_minutes" INTEGER,
    "importance" INTEGER NOT NULL DEFAULT 3,
    "assignee_id" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366F1',
    "uses" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_templates_user_id_space_id_position_idx" ON "task_templates"("user_id", "space_id", "position");

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
