/**
 * Workflows Feature Validation Schemas
 *
 * Zod v4 schemas specific to the workflows feature domain.
 * Common cross-feature validations live in /core/validation.ts
 */

import { z } from "zod/v4";

/**
 * Workflow name parameter
 */
export const ParamWorkflowName = z
  .string()
  .min(1)
  .describe("The name of the workflow");

/**
 * Workflow version parameter (optional)
 * Must be a positive integer
 */
export const ParamWorkflowVersion = z.coerce
  .number()
  .int()
  .positive()
  .optional()
  .describe("Specific version number to retrieve (e.g., 1, 2, 3)");
