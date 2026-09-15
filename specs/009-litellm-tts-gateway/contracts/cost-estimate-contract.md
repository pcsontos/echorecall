# Contract: Cost estimates for gateway models

**Feature**: 009-litellm-tts-gateway | **Date**: 2026-09-14

Pre-generation cost display in Generate and batch preview. See [data-model.md](../data-model.md) §5 and [research.md](../research.md) R5.

## Core API (browser-safe)

```ts
function estimateItemCost(
  model: string,
  text: string,
  gatewayRates?: Readonly<Record<string, GatewayRate>>,
): CostEstimate
```

`CostEstimate` remains `{ amountUsd: number } | 'unavailable'`.

## Resolution

1. If `MODEL_PRICING[model]` exists, use the existing OpenAI table (character or duration). Ignore gateway rates for that id.
2. Else if `gatewayRates?.[model]` has `inputCostPerCharacter` or `outputCostPerCharacter`, return `{ amountUsd: text.length * rate }` using the first present field.
3. Else if it has `outputCostPerSecond`, return `{ amountUsd: (wordCount / 150) * 60 * rate }` with the same word split as `gpt-4o-mini-tts`.
4. Else return `'unavailable'`.

Invariants:

- `'unavailable'` is never coerced to `$0.00`.
- Empty text on a **priced** model remains `{ amountUsd: 0 }` (existing behavior).
- Empty text on an unpriced model is `'unavailable'`.
- Non-finite or negative gateway fields are ignored (treat as missing).

## Queue total

`useQueue.queueCost` is unchanged in shape:

- `perItem: Map<clientId, CostEstimate>`
- `totalUsd`: sum of `amountUsd` only
- `unavailableCount`: number of `'unavailable'` items

It must pass the catalog `rates` map into `estimateItemCost`. When the catalog has not loaded or has `catalogError`, `gatewayRates` is `{}` and unknown models are unavailable.

Batch preview cost, if shown, uses the same function and the same rates map.

## Out of scope

- Settings field for a manual third-party rate
- Post-generation `x-litellm-response-cost` as the Generate estimate
- Token-only chat rates as a TTS estimate
