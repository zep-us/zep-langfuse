/**
 * MCP Streamable HTTP Transport
 *
 * Implements Streamable HTTP transport for the Model Context Protocol (2025-03-26 spec).
 * This transport allows MCP communication over HTTP with JSON-RPC messages.
 *
 */

import { type NextApiRequest, type NextApiResponse } from "next";
import { type Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { formatErrorForUser } from "../core/error-formatting";
import { logger } from "@langfuse/shared/src/server";

/**
 * Handle MCP request using Streamable HTTP transport.
 *
 * This function:
 * 1. Sets CORS headers for MCP clients
 * 2. Creates a StreamableHTTPServerTransport (stateless mode)
 * 3. Connects to server to transport
 * 4. Routes to request to the transport handler
 * 5. Transport handles to response lifecycle
 *
 * Supports:
 * - POST: JSON-RPC requests (initialize, tool calls, etc.)
 * - GET: SSE stream for server-initiated messages (optional)
 * - DELETE: Session termination (returns 405 for stateless)
 * - OPTIONS: CORS preflight
 *
 * @param server - MCP Server instance (created per-request)
 * @param req - Next.js API request
 * @param res - Next.js API response
 */
export async function handleMcpRequest(
  server: Server,
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  try {
    // Note: CORS headers and OPTIONS handling are now in index.ts (before authentication)

    // Validate Accept header for POST requests (per spec)
    if (req.method === "POST") {
      const acceptHeader = req.headers.accept || "";
      if (
        !acceptHeader.includes("application/json") &&
        !acceptHeader.includes("text/event-stream") &&
        !acceptHeader.includes("*/*")
      ) {
        res.status(406).json({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message:
              "Invalid Request: Accept header must include application/json or text/event-stream",
          },
          id: null,
        });
        return;
      }
    }

    // Create WebStandard HTTP transport (stateless mode - no sessionIdGenerator)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode
      enableJsonResponse: true, // Use JSON response (simpler for stateless mode)
    });

    // Connect server to transport
    await server.connect(transport);

    logger.info("MCP server connected via Web Standard HTTP transport", {
      method: req.method,
    });

    // Convert Next.js IncomingMessage to Web Standard Request
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers.host || "localhost";
    const url = `${protocol}://${host}${req.url}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.set(key, value);
      }
    }

    const isBodyMethod =
      req.method !== "GET" && req.method !== "DELETE" && req.method !== "HEAD";
    const body =
      isBodyMethod && req.body ? JSON.stringify(req.body) : undefined;

    const webRequest = new Request(url, {
      method: req.method,
      headers,
      body,
    });

    // handleRequest returns a Web Standard Response
    const webResponse = await transport.handleRequest(webRequest, {
      parsedBody: req.body,
    });

    // Write the Web Standard Response back to Next.js ServerResponse
    res.status(webResponse.status);
    webResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const responseBody = await webResponse.text();
    res.end(responseBody);
  } catch (error) {
    logger.error("MCP transport error", {
      message: error instanceof Error ? error.message : "Unknown",
      name: error instanceof Error ? error.name : typeof error,
      method: req.method,
    });

    // If headers not sent, send JSON-RPC error response
    if (!res.headersSent) {
      const mcpError = formatErrorForUser(error);
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: mcpError.message,
        },
        id: null,
      });
    }
  }
}
