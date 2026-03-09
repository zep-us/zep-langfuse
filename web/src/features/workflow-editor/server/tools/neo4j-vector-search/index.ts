/**
 * Neo4j Vector Search Tool
 *
 * Searches achievement standards in a Neo4j database using vector similarity.
 * Ported from: build-multi-turn/src/services/standard_service.py
 *
 * Requires environment variables:
 * - NEO4J_URI: Neo4j connection URI
 * - NEO4J_USER: Neo4j username
 * - NEO4J_PASSWORD: Neo4j password
 *
 * Uses project-level OpenAI API key for embedding generation.
 */

import { registerTool } from "../registry";
import { executeVectorSearch } from "./executor";
import type { ToolDefinition } from "../types";

const neo4jVectorSearchTool: ToolDefinition = {
  type: "neo4j-vector-search",
  label: "Neo4j Vector Search",
  description:
    "Search achievement standards in Neo4j using vector similarity (embedding-based search)",
  configFields: [
    {
      key: "indexName",
      label: "Vector Index Name",
      type: "string",
      description:
        "Neo4j vector index name (e.g., achievement_standard_index_openai)",
      defaultValue: "achievement_standard_index_openai",
      required: true,
    },
    {
      key: "topK",
      label: "Top K Results",
      type: "number",
      description: "Number of results to return (1-20)",
      defaultValue: 5,
      required: false,
    },
    {
      key: "embeddingModel",
      label: "Embedding Model",
      type: "string",
      description: "OpenAI embedding model name",
      defaultValue: "text-embedding-3-small",
      required: false,
    },
    {
      key: "queryField",
      label: "Query Input Field",
      type: "string",
      description:
        "Input field name containing the search query (from upstream node or workflow context)",
      defaultValue: "current_message",
      required: false,
    },
    {
      key: "gradeFilter",
      label: "Grade Filter",
      type: "string",
      description:
        'Optional grade filter (e.g., "초등학교 3~4학년"). Leave empty for all grades.',
      defaultValue: "",
      required: false,
    },
    {
      key: "minScoreThreshold",
      label: "Minimum Score Threshold",
      type: "number",
      description: "Minimum similarity score threshold (0.0 - 1.0)",
      defaultValue: 0.3,
      required: false,
    },
  ],
  execute: executeVectorSearch,
};

registerTool(neo4jVectorSearchTool);

export default neo4jVectorSearchTool;
