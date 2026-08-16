-- The interview no longer scores questions, so QuestionHistory.qValue has no
-- source; what it needs instead is whether the question opened a topic, stayed
-- on one, or moved off it, because that boundary is what the reading counts
-- "returning" against.
ALTER TABLE "QuestionHistory" DROP COLUMN "qValue";
ALTER TABLE "QuestionHistory" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'deepen';

-- CreateTable
CREATE TABLE "Reading" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "turnCount" INTEGER NOT NULL,
    "topics" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Reading_sessionId_key" ON "Reading"("sessionId");

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
