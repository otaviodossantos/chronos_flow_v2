-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH');

-- CreateEnum
CREATE TYPE "NodeStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrainingLevel" AS ENUM ('NOT_STARTED', 'IN_TRAINING', 'AUTONOMOUS');

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "whatsapp" TEXT,
    "training_level" "TrainingLevel" NOT NULL DEFAULT 'NOT_STARTED',
    "capacity_hours_week" INTEGER NOT NULL DEFAULT 40,
    "color" TEXT NOT NULL DEFAULT '#6366F1',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_activity" (
    "id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'Voce',
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_dependencies" (
    "id" TEXT NOT NULL,
    "blocker_id" TEXT NOT NULL,
    "blocked_id" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
    "lag_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "node_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nodes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "space_id" TEXT,
    "parent_id" TEXT,
    "path" TEXT NOT NULL DEFAULT '',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "NodeStatus" NOT NULL DEFAULT 'PENDING',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "progress" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "manual_progress" DECIMAL(5,2),
    "leaf_count" INTEGER NOT NULL DEFAULT 0,
    "rollup_dirty" BOOLEAN NOT NULL DEFAULT false,
    "start_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "estimated_minutes" INTEGER,
    "planned_date" TIMESTAMP(3),
    "scheduled_start" TEXT,
    "scheduled_end" TEXT,
    "completed_at" TIMESTAMP(3),
    "importance" INTEGER NOT NULL DEFAULT 3,
    "root_impact" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "assignee_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_snapshots" (
    "id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "progress" DECIMAL(5,2) NOT NULL,
    "leaf_effort" INTEGER NOT NULL DEFAULT 0,
    "captured_on" DATE NOT NULL,

    CONSTRAINT "progress_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_members" (
    "id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spaces" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#10B981',
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birth_date" TIMESTAMP(3) NOT NULL DEFAULT '1990-01-01 00:00:00'::timestamp without time zone,
    "life_expectancy" INTEGER NOT NULL DEFAULT 75,
    "daily_focus_goal_minutes" INTEGER NOT NULL DEFAULT 240,
    "daily_impact_goal" DECIMAL(5,2) NOT NULL DEFAULT 1.0,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "members_user_id_idx" ON "members"("user_id" ASC);

-- CreateIndex
CREATE INDEX "node_activity_node_id_created_at_idx" ON "node_activity"("node_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "node_dependencies_blocked_id_idx" ON "node_dependencies"("blocked_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "node_dependencies_blocker_id_blocked_id_key" ON "node_dependencies"("blocker_id" ASC, "blocked_id" ASC);

-- CreateIndex
CREATE INDEX "nodes_assignee_id_status_idx" ON "nodes"("assignee_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "nodes_parent_id_position_idx" ON "nodes"("parent_id" ASC, "position" ASC);

-- CreateIndex
CREATE INDEX "nodes_planned_date_idx" ON "nodes"("planned_date" ASC);

-- CreateIndex
CREATE INDEX "nodes_space_id_depth_idx" ON "nodes"("space_id" ASC, "depth" ASC);

-- CreateIndex
CREATE INDEX "nodes_user_id_path_idx" ON "nodes"("user_id" ASC, "path" ASC);

-- CreateIndex
CREATE INDEX "progress_snapshots_captured_on_idx" ON "progress_snapshots"("captured_on" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "progress_snapshots_node_id_captured_on_key" ON "progress_snapshots"("node_id" ASC, "captured_on" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "space_members_space_id_member_id_key" ON "space_members"("space_id" ASC, "member_id" ASC);

-- CreateIndex
CREATE INDEX "spaces_user_id_position_idx" ON "spaces"("user_id" ASC, "position" ASC);

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_activity" ADD CONSTRAINT "node_activity_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_dependencies" ADD CONSTRAINT "node_dependencies_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "node_dependencies" ADD CONSTRAINT "node_dependencies_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_snapshots" ADD CONSTRAINT "progress_snapshots_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

