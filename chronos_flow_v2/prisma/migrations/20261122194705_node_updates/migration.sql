-- CreateTable
CREATE TABLE "node_updates" (
    "id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'Voce',
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "node_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "node_updates_node_id_created_at_idx" ON "node_updates"("node_id", "created_at");

-- AddForeignKey
ALTER TABLE "node_updates" ADD CONSTRAINT "node_updates_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
