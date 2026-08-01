-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "processing" BOOLEAN NOT NULL DEFAULT false,
    "turnCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConversationTurn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ElementState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "score" REAL NOT NULL DEFAULT 50,
    "confidence" REAL NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "evidenceDiversity" REAL NOT NULL DEFAULT 0,
    "evidenceTypes" TEXT NOT NULL DEFAULT '[]',
    "lastUpdatedTurn" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ElementState_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turnId" INTEGER NOT NULL,
    "elementId" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "strength" REAL NOT NULL,
    "reliability" REAL NOT NULL,
    "direction" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Evidence_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScoreHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "elementStateId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "score" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    "delta" REAL NOT NULL,
    "causeEvidenceIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScoreHistory_elementStateId_fkey" FOREIGN KEY ("elementStateId") REFERENCES "ElementState" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contradiction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "elementIds" TEXT NOT NULL,
    "evidenceAId" TEXT NOT NULL,
    "evidenceBId" TEXT NOT NULL,
    "severity" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unresolved',
    "detectedTurn" INTEGER NOT NULL,
    "resolutionNote" TEXT,
    CONSTRAINT "Contradiction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "targetElements" TEXT NOT NULL,
    "probeKind" TEXT NOT NULL,
    "qValue" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionHistory_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AxisSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "axisId" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    "coverage" REAL NOT NULL,
    CONSTRAINT "AxisSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Session_status_idx" ON "Session"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationTurn_sessionId_turnIndex_role_key" ON "ConversationTurn"("sessionId", "turnIndex", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ElementState_sessionId_elementId_key" ON "ElementState"("sessionId", "elementId");

-- CreateIndex
CREATE INDEX "Evidence_sessionId_elementId_idx" ON "Evidence"("sessionId", "elementId");

-- CreateIndex
CREATE INDEX "ScoreHistory_elementStateId_idx" ON "ScoreHistory"("elementStateId");

-- CreateIndex
CREATE INDEX "Contradiction_sessionId_status_idx" ON "Contradiction"("sessionId", "status");

-- CreateIndex
CREATE INDEX "QuestionHistory_sessionId_idx" ON "QuestionHistory"("sessionId");

-- CreateIndex
CREATE INDEX "AxisSnapshot_sessionId_turn_idx" ON "AxisSnapshot"("sessionId", "turn");
