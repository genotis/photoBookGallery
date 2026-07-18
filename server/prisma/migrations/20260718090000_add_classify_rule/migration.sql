-- CreateTable
CREATE TABLE "ClassifyRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rootId" INTEGER,
    "matchType" TEXT NOT NULL DEFAULT 'regex',
    "pattern" TEXT NOT NULL,
    "destTemplate" TEXT NOT NULL,
    "scanCron" TEXT,
    "scheduleOn" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClassifyRule_rootId_fkey" FOREIGN KEY ("rootId") REFERENCES "LibraryRoot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ClassifyRule_priority_idx" ON "ClassifyRule"("priority");

-- CreateIndex
CREATE INDEX "ClassifyRule_rootId_idx" ON "ClassifyRule"("rootId");
