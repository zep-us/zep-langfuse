/**
 * HTTP API Call Tool
 *
 * Generic tool for making HTTP POST requests to external APIs.
 * Used to delegate business logic to external services (e.g., Python service
 * for vector search) instead of reimplementing it in the workflow engine.
 */

import { registerTool } from "../registry";
import { executeHttpApiCall } from "./executor";
import type { ToolDefinition } from "../types";

const httpApiCallTool: ToolDefinition = {
  type: "http-api-call",
  label: "HTTP API Call",
  description:
    "Make an HTTP POST request to an external API endpoint. Delegates business logic to external services.",
  configFields: [
    {
      key: "apiUrlEnvVar",
      label: "API URL Environment Variable",
      type: "string",
      description:
        "Environment variable name containing the API base URL (must start with WORKFLOW_TOOL_)",
      defaultValue: "WORKFLOW_TOOL_SEARCH_API_URL",
      required: true,
    },
    {
      key: "apiPath",
      label: "API Path",
      type: "string",
      description:
        "API endpoint path appended to the base URL (e.g., /api/v1/search-standards-vector)",
      defaultValue: "/api/v1/search-standards-vector",
      required: true,
    },
    {
      key: "apiKeyHeader",
      label: "API Key Header Name",
      type: "string",
      description: "HTTP header name for the API key",
      defaultValue: "X-API-Key",
      required: false,
    },
    {
      key: "apiKeyEnvVar",
      label: "API Key Environment Variable",
      type: "string",
      description:
        "Environment variable name containing the API key (must start with WORKFLOW_TOOL_)",
      defaultValue: "WORKFLOW_TOOL_SEARCH_API_KEY",
      required: false,
    },
    {
      key: "requestBodyTemplate",
      label: "Request Body Template (JSON)",
      type: "string",
      description:
        'JSON template for the request body. Use ${fieldName} for input data substitution (e.g., {"query": "${current_message}", "top_k": 10})',
      defaultValue: '{"query": "${current_message}", "top_k": 10}',
      required: false,
    },
    {
      key: "timeoutMs",
      label: "Timeout (ms)",
      type: "number",
      description: "Request timeout in milliseconds",
      defaultValue: 30000,
      required: false,
    },
  ],
  execute: executeHttpApiCall,
};

registerTool(httpApiCallTool);

export default httpApiCallTool;
