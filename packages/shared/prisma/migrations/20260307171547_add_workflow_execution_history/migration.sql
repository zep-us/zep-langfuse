-- AlterTable
ALTER TABLE "workflows" ADD COLUMN "last_execution_at" TIMESTAMP(3),
ADD COLUMN "last_execution_results" JSONB,
ADD COLUMN "last_execution_status" TEXT;
