-- AlterTable
ALTER TABLE "Model" ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Model_favorite_idx" ON "Model"("favorite");
