/**
 * Neo4j Vector Search Executor
 *
 * Implements the actual vector search logic:
 * 1. Generate embedding for the search query (OpenAI text-embedding-3-small)
 * 2. Execute Cypher vector search query against Neo4j
 * 3. Score and filter results
 * 4. Return structured output for downstream nodes
 *
 * Ported from: build-multi-turn/src/services/standard_service.py
 */

import neo4j, { type Driver } from "neo4j-driver";
import { logger } from "@langfuse/shared/src/server";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";

// --- Constants (from build-multi-turn/src/constants.py) ---

const MIN_SCORE_THRESHOLD = 0.3;
const VECTOR_FETCH_MULTIPLIER = 3;
const MAX_WORD_OVERLAP_SCORE = 5;

// --- Neo4j Connection ---

let driverInstance: Driver | null = null;

function getNeo4jDriver(): Driver {
  if (driverInstance) return driverInstance;

  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !user || !password) {
    throw new Error(
      "Neo4j connection not configured. Set NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD environment variables.",
    );
  }

  driverInstance = neo4j.driver(uri, neo4j.auth.basic(user, password), {
    maxConnectionLifetime: 300000,
    maxConnectionPoolSize: 10,
    connectionAcquisitionTimeout: 60000,
    connectionTimeout: 30000,
  });

  return driverInstance;
}

// --- Embedding ---

async function generateEmbedding(params: {
  query: string;
  model: string;
  apiKey: string;
}): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      input: params.query,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `OpenAI Embedding API error (${response.status}): ${errorBody}`,
    );
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  if (!data.data?.[0]?.embedding) {
    throw new Error("Invalid embedding response from OpenAI");
  }

  return data.data[0].embedding;
}

// --- Cypher Query Builder ---

function buildVectorSearchQuery(indexName: string, fetchK: number): string {
  // Validate index name to prevent Cypher injection
  if (!/^[a-zA-Z0-9_]+$/.test(indexName)) {
    throw new Error(`Invalid index name: ${indexName}`);
  }

  if (!Number.isInteger(fetchK) || fetchK < 1 || fetchK > 100) {
    throw new Error(`Invalid fetchK: ${fetchK}`);
  }

  return `
    WITH $embedding AS queryEmbedding, $gradeFilter AS gradeFilter
    CALL db.index.vector.queryNodes('${indexName}', ${fetchK}, queryEmbedding)
    YIELD node, score
    WITH node, score, gradeFilter
    WHERE gradeFilter IS NULL OR node.gradeCluster IN gradeFilter
    RETURN DISTINCT node, score,
           node.gradeCluster AS grade,
           node.areaName AS subdomain
    ORDER BY score DESC
  `;
}

// --- Word Overlap Scoring (from text_utils.py) ---

function calculateWordOverlap(query: string, content: string): number {
  const queryWords = new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
  const contentWords = new Set(
    content
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );

  let overlap = 0;
  for (const word of queryWords) {
    if (contentWords.has(word)) {
      overlap++;
    }
  }
  return overlap;
}

// --- Grade Filter Extraction ---

const GRADE_SEARCH_PATTERNS: Record<string, string[]> = {
  "초등학교 1~2학년": [
    "초등 1학년",
    "초등 2학년",
    "초1",
    "초2",
    "1학년",
    "2학년",
  ],
  "초등학교 3~4학년": [
    "초등 3학년",
    "초등 4학년",
    "초3",
    "초4",
    "3학년",
    "4학년",
  ],
  "초등학교 5~6학년": [
    "초등 5학년",
    "초등 6학년",
    "초5",
    "초6",
    "5학년",
    "6학년",
  ],
  "중학교 1~3학년": ["중학교", "중등", "중1", "중2", "중3"],
  "고등학교 1~3학년": ["고등학교", "고등", "고1", "고2", "고3"],
};

function extractGradeFilter(query: string): {
  gradeFilter: string[] | null;
  cleanedQuery: string;
} {
  let cleanedQuery = query;
  let gradeFilter: string | string[] | null = null;

  for (const [grade, keywords] of Object.entries(GRADE_SEARCH_PATTERNS)) {
    for (const keyword of keywords) {
      if (query.includes(keyword)) {
        gradeFilter = grade;
        cleanedQuery = cleanedQuery.replace(keyword, "").trim();
        break;
      }
    }
    if (gradeFilter) break;
  }

  // "초등" alone → expand to all elementary grades
  if (!gradeFilter && query.includes("초등")) {
    gradeFilter = ["초등학교 1~2학년", "초등학교 3~4학년", "초등학교 5~6학년"];
  }

  const gradeFilterArray =
    gradeFilter === null
      ? null
      : Array.isArray(gradeFilter)
        ? gradeFilter
        : [gradeFilter];

  // Clean stopwords
  const stopwords = ["문제", "퀴즈", "만들어", "생성", "검색", "찾아"];
  for (const sw of stopwords) {
    cleanedQuery = cleanedQuery.replace(new RegExp(sw, "g"), "");
  }
  cleanedQuery = cleanedQuery.replace(/\s+/g, " ").trim();

  return { gradeFilter: gradeFilterArray, cleanedQuery };
}

// --- Main Executor ---

export async function executeVectorSearch(
  config: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    // Extract config
    const indexName =
      (config.indexName as string) || "achievement_standard_index_openai";
    const topK = Math.min(Math.max((config.topK as number) || 5, 1), 20);
    const embeddingModel =
      (config.embeddingModel as string) || "text-embedding-3-small";
    const queryField = (config.queryField as string) || "current_message";
    const configGradeFilter = (config.gradeFilter as string) || "";
    const minScore =
      (config.minScoreThreshold as number) || MIN_SCORE_THRESHOLD;

    // Get query from input data
    const query = context.inputData[queryField] as string;
    if (!query?.trim()) {
      return {
        success: true,
        output: { found_standards: [], count: 0 },
      };
    }

    // Extract grade filter from query
    const { gradeFilter: extractedGrade, cleanedQuery } =
      extractGradeFilter(query);
    const gradeFilter = configGradeFilter
      ? [configGradeFilter]
      : extractedGrade;

    // Get OpenAI API key from project's LLM keys
    const { prisma } = await import("@langfuse/shared/src/db");
    const llmApiKey = await prisma.llmApiKeys.findFirst({
      where: {
        projectId: context.projectId,
        provider: "openai",
      },
    });

    if (!llmApiKey?.secretKey) {
      return {
        success: false,
        output: {},
        error:
          "No OpenAI API key found in project. Please add one in project settings for embedding generation.",
      };
    }

    // Generate embedding
    const embedding = await generateEmbedding({
      query: cleanedQuery || query,
      model: embeddingModel,
      apiKey: llmApiKey.secretKey,
    });

    // Execute Neo4j vector search
    const driver = getNeo4jDriver();
    const fetchK = topK * VECTOR_FETCH_MULTIPLIER;
    const cypher = buildVectorSearchQuery(indexName, fetchK);

    const session = driver.session();
    try {
      const result = await session.run(cypher, {
        embedding,
        gradeFilter,
      });

      // Process results with scoring
      const standards: Array<Record<string, unknown>> = [];

      for (const record of result.records) {
        const node = record.get("node");
        const vectorScore =
          typeof record.get("score") === "number"
            ? (record.get("score") as number)
            : 0;
        const grade = record.get("grade") as string | null;
        const subdomain = record.get("subdomain") as string | null;

        if (!node) continue;

        const code = (node.properties.standardCode as string) || "";
        const content = (node.properties.content as string) || "";
        const explanation = (node.properties.explanation as string) || "";

        // Combined score: 80% vector + 20% word overlap
        const wordOverlap = calculateWordOverlap(
          cleanedQuery || query,
          content,
        );
        const normalizedOverlap = Math.min(
          wordOverlap / MAX_WORD_OVERLAP_SCORE,
          1.0,
        );
        const rawScore = vectorScore * 0.8 + normalizedOverlap * 0.2;
        const displayScore = Math.min(Math.round(rawScore * 50 + 50), 100);

        if (rawScore >= minScore) {
          standards.push({
            code,
            standard: content,
            explanation,
            score: displayScore,
            grade,
            subdomain,
          });
        }
      }

      // Sort by score desc and limit
      standards.sort((a, b) => (b.score as number) - (a.score as number));
      const topResults = standards.slice(0, topK);

      logger.info("Neo4j vector search completed", {
        projectId: context.projectId,
        query: cleanedQuery || query,
        totalResults: result.records.length,
        filteredResults: topResults.length,
      });

      return {
        success: true,
        output: {
          found_standards: topResults,
          count: topResults.length,
        },
      };
    } finally {
      await session.close();
    }
  } catch (error) {
    logger.error("Neo4j vector search failed", {
      error: error instanceof Error ? error.message : String(error),
      projectId: context.projectId,
    });

    return {
      success: false,
      output: {},
      error:
        error instanceof Error ? error.message : "Neo4j vector search failed",
    };
  }
}
