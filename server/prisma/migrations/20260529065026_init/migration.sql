-- CreateTable
CREATE TABLE "LibraryRoot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "path" TEXT NOT NULL,
    "label" TEXT,
    "readOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Archive" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "rootId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "mtime" DATETIME NOT NULL,
    "contentHash" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "coverEntry" TEXT,
    "countryId" INTEGER,
    "publisherId" INTEGER,
    "seriesId" INTEGER,
    "publishedAt" DATETIME,
    "rating" INTEGER,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "indexedAt" DATETIME,
    "missing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Archive_rootId_fkey" FOREIGN KEY ("rootId") REFERENCES "LibraryRoot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Archive_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Archive_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Archive_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "archiveId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "sizeBytes" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "isImage" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Entry_archiveId_fkey" FOREIGN KEY ("archiveId") REFERENCES "Archive" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Model" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "aliases" TEXT,
    "profileImg" TEXT,
    "bio" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ArchiveModel" (
    "archiveId" INTEGER NOT NULL,
    "modelId" INTEGER NOT NULL,

    PRIMARY KEY ("archiveId", "modelId"),
    CONSTRAINT "ArchiveModel_archiveId_fkey" FOREIGN KEY ("archiveId") REFERENCES "Archive" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArchiveModel_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "Model" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Publisher" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "kind" TEXT
);

-- CreateTable
CREATE TABLE "Country" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Series" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ArchiveTag" (
    "archiveId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    PRIMARY KEY ("archiveId", "tagId"),
    CONSTRAINT "ArchiveTag_archiveId_fkey" FOREIGN KEY ("archiveId") REFERENCES "Archive" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArchiveTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" TEXT NOT NULL,
    "progress" REAL NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "LibraryRoot_path_key" ON "LibraryRoot"("path");

-- CreateIndex
CREATE UNIQUE INDEX "Archive_path_key" ON "Archive"("path");

-- CreateIndex
CREATE UNIQUE INDEX "Archive_contentHash_key" ON "Archive"("contentHash");

-- CreateIndex
CREATE INDEX "Archive_countryId_idx" ON "Archive"("countryId");

-- CreateIndex
CREATE INDEX "Archive_publisherId_idx" ON "Archive"("publisherId");

-- CreateIndex
CREATE INDEX "Archive_seriesId_idx" ON "Archive"("seriesId");

-- CreateIndex
CREATE INDEX "Archive_favorite_idx" ON "Archive"("favorite");

-- CreateIndex
CREATE INDEX "Archive_rating_idx" ON "Archive"("rating");

-- CreateIndex
CREATE INDEX "Archive_mtime_idx" ON "Archive"("mtime");

-- CreateIndex
CREATE INDEX "Archive_contentHash_idx" ON "Archive"("contentHash");

-- CreateIndex
CREATE INDEX "Entry_archiveId_order_idx" ON "Entry"("archiveId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Entry_archiveId_name_key" ON "Entry"("archiveId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Model_name_key" ON "Model"("name");

-- CreateIndex
CREATE INDEX "ArchiveModel_modelId_idx" ON "ArchiveModel"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "Publisher_name_key" ON "Publisher"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "ArchiveTag_tagId_idx" ON "ArchiveTag"("tagId");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_type_idx" ON "Job"("type");
