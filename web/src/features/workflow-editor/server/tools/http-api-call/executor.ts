/**
 * HTTP API Call Executor
 *
 * Makes HTTP POST requests to external APIs. This is a generic transport layer —
 * all business logic lives in the external service.
 *
 * Template syntax uses ${fieldName} (NOT {{fieldName}}) to avoid collision
 * with the workflow engine's own mustache-style variable resolution.
 *
 * Environment variable names must start with WORKFLOW_TOOL_ for security
 * (prevents arbitrary env var exfiltration via toolConfig).
 */

import { logger } from "@langfuse/shared/src/server";
import type { ToolExecutionContext, ToolExecutionResult } from "../types";

const ALLOWED_ENV_PREFIX = "WORKFLOW_TOOL_";

/**
 * Resolve an environment variable by name, with prefix security check.
 */
function resolveEnvVar(envVarName: string): string | undefined {
  if (!envVarName) return undefined;
  if (!envVarName.startsWith(ALLOWED_ENV_PREFIX)) {
    throw new Error(
      `Environment variable name '${envVarName}' must start with '${ALLOWED_ENV_PREFIX}'`,
    );
  }
  return process.env[envVarName];
}

/**
 * Substitute ${fieldName} placeholders in a template string with values from inputData.
 * Uses ${} syntax (not {{}}) to avoid collision with workflow engine templates.
 */
function resolveTemplate(
  template: string,
  inputData: Record<string, unknown>,
): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, fieldName: string) => {
    const trimmed = fieldName.trim();
    const value = inputData[trimmed];
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

export async function executeHttpApiCall(
  config: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  try {
    // --- Read config ---
    const apiUrlEnvVar = (config.apiUrlEnvVar as string) || "";
    const apiPath = (config.apiPath as string) || "";
    const apiKeyHeader = (config.apiKeyHeader as string) || "X-API-Key";
    const apiKeyEnvVar = (config.apiKeyEnvVar as string) || "";
    const requestBodyTemplate =
      (config.requestBodyTemplate as string) ||
      '{"query": "${current_message}", "top_k": 10}';
    const timeoutMs = Math.min(
      Math.max((config.timeoutMs as number) || 30000, 1000),
      120000,
    );

    // --- Resolve API URL from env var ---
    if (!apiUrlEnvVar) {
      return {
        success: false,
        output: {},
        error:
          "apiUrlEnvVar is required. Set the environment variable name containing the API base URL.",
      };
    }

    const baseUrl = resolveEnvVar(apiUrlEnvVar);
    if (!baseUrl) {
      return {
        success: false,
        output: {},
        error: `API URL not configured. Set the ${apiUrlEnvVar} environment variable.`,
      };
    }

    const fullUrl = baseUrl.replace(/\/+$/, "") + apiPath;

    // --- Resolve API key from env var ---
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (apiKeyEnvVar) {
      const apiKey = resolveEnvVar(apiKeyEnvVar);
      if (!apiKey) {
        return {
          success: false,
          output: {},
          error: `API key not configured. Set the ${apiKeyEnvVar} environment variable.`,
        };
      }
      headers[apiKeyHeader] = apiKey;
    }

    // --- Build request body from template ---
    const bodyString = resolveTemplate(requestBodyTemplate, context.inputData);

    // Validate that the body is valid JSON
    try {
      JSON.parse(bodyString);
    } catch {
      return {
        success: false,
        output: {},
        error: `Request body template produced invalid JSON: ${bodyString.slice(0, 200)}`,
      };
    }

    // --- Execute HTTP request ---
    logger.info("HTTP API call", {
      url: fullUrl,
      projectId: context.projectId,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(fullUrl, {
        method: "POST",
        headers,
        body: bodyString,
        signal: controller.signal,
      });

      // Consume body
      const responseText = await response.text();

      if (!response.ok) {
        logger.error("HTTP API call failed", {
          url: fullUrl,
          status: response.status,
          body: responseText.slice(0, 500),
          projectId: context.projectId,
        });

        return {
          success: false,
          output: {},
          error: `HTTP ${response.status}: ${responseText.slice(0, 300)}`,
        };
      }

      // Parse JSON response
      let responseJson: Record<string, unknown>;
      try {
        responseJson = JSON.parse(responseText) as Record<string, unknown>;
      } catch {
        return {
          success: false,
          output: {},
          error: `Invalid JSON response from API: ${responseText.slice(0, 200)}`,
        };
      }

      logger.info("HTTP API call succeeded", {
        url: fullUrl,
        projectId: context.projectId,
      });

      return {
        success: true,
        output: responseJson,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return {
          success: false,
          output: {},
          error: `Request timed out after ${timeoutMs}ms`,
        };
      }

      // Check for Node.js fetch errors (connection refused, DNS failure, etc.)
      const errMessage = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output: {},
        error: `Network error: ${errMessage}`,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    logger.error("HTTP API call executor error", {
      error: error instanceof Error ? error.message : String(error),
      projectId: context.projectId,
    });

    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : "HTTP API call failed",
    };
  }
}
