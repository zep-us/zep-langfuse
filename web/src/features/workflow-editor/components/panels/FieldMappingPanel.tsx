import React from "react";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/src/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/src/components/ui/select";
import { Input } from "@/src/components/ui/input";
import { Button } from "@/src/components/ui/button";
import { Toggle } from "@/src/components/ui/toggle";
import type { FieldMapping } from "../../types";

interface FieldMappingPanelProps {
  mappings: FieldMapping[];
  availableNodes: Array<{ id: string; label: string }>;
  onChange: (mappings: FieldMapping[]) => void;
}

export function FieldMappingPanel({
  mappings,
  availableNodes,
  onChange,
}: FieldMappingPanelProps) {
  const handleAddMapping = () => {
    const newMapping: FieldMapping = {
      sourceField: "",
      targetVariable: "",
      mappingType: "field",
    };
    onChange([...mappings, newMapping]);
  };

  const handleDeleteMapping = (index: number) => {
    const newMappings = mappings.filter((_, i) => i !== index);
    onChange(newMappings);
  };

  const handleUpdateMapping = (
    index: number,
    updates: Partial<FieldMapping>,
  ) => {
    const newMappings = mappings.map((mapping, i) =>
      i === index ? { ...mapping, ...updates } : mapping,
    );
    onChange(newMappings);
  };

  // Parse sourceField to extract node ID and field path
  const parseSourceField = (sourceField: string) => {
    const parts = sourceField.split(".");
    if (parts.length === 0) return { nodeId: "", fieldPath: "" };
    const nodeId = parts[0] || "";
    const fieldPath = parts.slice(1).join(".");
    return { nodeId, fieldPath };
  };

  // Combine node ID and field path into sourceField format
  const buildSourceField = (nodeId: string, fieldPath: string) => {
    if (!nodeId) return "";
    return fieldPath ? `${nodeId}.${fieldPath}` : nodeId;
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground">
          <p className="mb-1">
            Configure how data flows from upstream nodes to this node:
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              <strong>Full:</strong> Pass the entire output from the source node
            </li>
            <li>
              <strong>Field:</strong> Extract a specific field using dot
              notation (e.g., &quot;output.topic&quot;)
            </li>
          </ul>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[200px]">Source Node</TableHead>
              <TableHead className="w-[200px]">Source Field</TableHead>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead className="w-[200px]">Target Variable</TableHead>
              <TableHead className="w-[120px]">Type</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  <div className="text-sm text-muted-foreground">
                    No field mappings configured. Click &quot;Add Mapping&quot;
                    to get started.
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              mappings.map((mapping, index) => {
                const { nodeId, fieldPath } = parseSourceField(
                  mapping.sourceField,
                );

                return (
                  <TableRow key={index}>
                    <TableCell>
                      <Select
                        value={nodeId}
                        onValueChange={(value) => {
                          const newSourceField = buildSourceField(
                            value,
                            fieldPath,
                          );
                          handleUpdateMapping(index, {
                            sourceField: newSourceField,
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select node" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableNodes.map((node) => (
                            <SelectItem key={node.id} value={node.id}>
                              {node.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        placeholder="e.g., output.topic"
                        value={fieldPath}
                        onChange={(e) => {
                          const newSourceField = buildSourceField(
                            nodeId,
                            e.target.value,
                          );
                          handleUpdateMapping(index, {
                            sourceField: newSourceField,
                          });
                        }}
                        disabled={mapping.mappingType === "full"}
                      />
                    </TableCell>
                    <TableCell>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                    <TableCell>
                      <Input
                        placeholder="Variable name"
                        value={mapping.targetVariable}
                        onChange={(e) =>
                          handleUpdateMapping(index, {
                            targetVariable: e.target.value,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Toggle
                          size="xs"
                          pressed={mapping.mappingType === "full"}
                          onPressedChange={(pressed) => {
                            handleUpdateMapping(index, {
                              mappingType: pressed ? "full" : "field",
                            });
                          }}
                          className="flex-1"
                        >
                          Full
                        </Toggle>
                        <Toggle
                          size="xs"
                          pressed={mapping.mappingType === "field"}
                          onPressedChange={(pressed) => {
                            handleUpdateMapping(index, {
                              mappingType: pressed ? "field" : "full",
                            });
                          }}
                          className="flex-1"
                        >
                          Field
                        </Toggle>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleDeleteMapping(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Button variant="outline" size="sm" onClick={handleAddMapping}>
        <Plus className="mr-2 h-4 w-4" />
        Add Mapping
      </Button>
    </div>
  );
}
