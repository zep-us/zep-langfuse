/**
 * Workflows MCP Feature Module
 *
 * Provides tools for managing Langfuse workflows via the MCP protocol.
 * This module exports all workflow-related tools for registration with the MCP server.
 *
 * Tools provided:
 * - listWorkflows: List and filter workflows with pagination (read-only)
 * - getWorkflow: Fetch a specific workflow by ID (read-only)
 * - createWorkflow: Create a new workflow (destructive)
 * - updateWorkflow: Update workflow metadata (destructive)
 * - deleteWorkflow: Delete a workflow (destructive)
 * - updateNodePrompt: Update the prompt assigned to a workflow node (destructive)
 * - addNode: Add a node to a workflow (destructive)
 * - removeNode: Remove a node from a workflow (destructive)
 * - connectNodes: Connect two nodes in a workflow (destructive)
 * - disconnectNodes: Disconnect two nodes in a workflow (destructive)
 */

import type { McpFeatureModule } from "../../server/registry";
import { listWorkflowsTool, handleListWorkflows } from "./tools/listWorkflows";
import { getWorkflowTool, handleGetWorkflow } from "./tools/getWorkflow";
import {
  createWorkflowTool,
  handleCreateWorkflow,
} from "./tools/createWorkflow";
import {
  updateWorkflowTool,
  handleUpdateWorkflow,
} from "./tools/updateWorkflow";
import {
  deleteWorkflowTool,
  handleDeleteWorkflow,
} from "./tools/deleteWorkflow";
import {
  updateNodePromptTool,
  handleUpdateNodePrompt,
} from "./tools/updateNodePrompt";
import { addNodeTool, handleAddNode } from "./tools/addNode";
import { removeNodeTool, handleRemoveNode } from "./tools/removeNode";
import { connectNodesTool, handleConnectNodes } from "./tools/connectNodes";
import {
  disconnectNodesTool,
  handleDisconnectNodes,
} from "./tools/disconnectNodes";

/**
 * Workflows Feature Module
 *
 * Registers all workflow management tools with the MCP server.
 * Tools are automatically available to MCP clients once registered.
 */
export const workflowsFeature: McpFeatureModule = {
  name: "workflows",
  description:
    "Manage Langfuse workflows - create, retrieve, update, and orchestrate workflow nodes",

  tools: [
    {
      definition: listWorkflowsTool,
      handler: handleListWorkflows,
    },
    {
      definition: getWorkflowTool,
      handler: handleGetWorkflow,
    },
    {
      definition: createWorkflowTool,
      handler: handleCreateWorkflow,
    },
    {
      definition: updateWorkflowTool,
      handler: handleUpdateWorkflow,
    },
    {
      definition: deleteWorkflowTool,
      handler: handleDeleteWorkflow,
    },
    {
      definition: updateNodePromptTool,
      handler: handleUpdateNodePrompt,
    },
    {
      definition: addNodeTool,
      handler: handleAddNode,
    },
    {
      definition: removeNodeTool,
      handler: handleRemoveNode,
    },
    {
      definition: connectNodesTool,
      handler: handleConnectNodes,
    },
    {
      definition: disconnectNodesTool,
      handler: handleDisconnectNodes,
    },
  ],

  // Optional: Feature can be conditionally enabled based on context
  // isEnabled: async (context) => {
  //   // Example: Check entitlements, feature flags, etc.
  //   return true;
  // },
};
