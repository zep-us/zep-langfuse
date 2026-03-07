import type { UIModelParams } from "@langfuse/shared";

/**
 * Converts UIModelParams (with enabled flags) to plain ModelParams for server
 * Handles both string values and object values with .value property
 */
export function convertUIModelParamsToModelParams(uiParams: UIModelParams) {
  return {
    provider:
      typeof uiParams.provider === "object" && "value" in uiParams.provider
        ? uiParams.provider.value
        : uiParams.provider,
    model:
      typeof uiParams.model === "object" && "value" in uiParams.model
        ? uiParams.model.value
        : uiParams.model,
    adapter:
      typeof uiParams.adapter === "object" && "value" in uiParams.adapter
        ? uiParams.adapter.value
        : uiParams.adapter,
    temperature: uiParams.temperature?.enabled
      ? uiParams.temperature.value
      : undefined,
    max_tokens: uiParams.max_tokens?.enabled
      ? uiParams.max_tokens.value
      : undefined,
    top_p: uiParams.top_p?.enabled ? uiParams.top_p.value : undefined,
    maxReasoningTokens: uiParams.maxReasoningTokens?.enabled
      ? uiParams.maxReasoningTokens.value
      : undefined,
    providerOptions: uiParams.providerOptions?.enabled
      ? uiParams.providerOptions.value
      : undefined,
  };
}
