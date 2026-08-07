-- CreateTable
CREATE TABLE "TurnDiagnostic" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "analystOk" BOOLEAN NOT NULL DEFAULT true,
    "analystError" TEXT,
    "extracted" INTEGER NOT NULL DEFAULT 0,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "rejectedReasons" TEXT NOT NULL DEFAULT '{}',
    "repaired" BOOLEAN NOT NULL DEFAULT false,
    "droppedByLimits" INTEGER NOT NULL DEFAULT 0,
    "questionSource" TEXT NOT NULL DEFAULT 'llm',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TurnDiagnostic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TurnDiagnostic_sessionId_idx" ON "TurnDiagnostic"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "TurnDiagnostic_sessionId_turn_key" ON "TurnDiagnostic"("sessionId", "turn");

-- AddForeignKey
ALTER TABLE "TurnDiagnostic" ADD CONSTRAINT "TurnDiagnostic_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
