-- CreateTable
CREATE TABLE "ClassifyMove" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "archiveId" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "jobId" INTEGER,
    "ruleId" INTEGER,
    "ruleName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'moved',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "ClassifyMove_jobId_idx" ON "ClassifyMove"("jobId");

-- CreateIndex
CREATE INDEX "ClassifyMove_archiveId_idx" ON "ClassifyMove"("archiveId");

-- CreateIndex
CREATE INDEX "ClassifyMove_status_idx" ON "ClassifyMove"("status");

-- CreateIndex
CREATE INDEX "ClassifyMove_createdAt_idx" ON "ClassifyMove"("createdAt");
