/** Rough, list-price cost estimate for a run — not billing. Prices are USD per
 *  1M tokens and drift; keep the table current or the number lies. Unknown
 *  models return null so the UI can omit cost rather than guess. */

export type ModelPrice = { input: number; output: number };

const PRICES: Array<{ pattern: RegExp; price: ModelPrice }> = [
	{ pattern: /claude.*haiku/i, price: { input: 1, output: 5 } },
	{ pattern: /claude.*sonnet/i, price: { input: 3, output: 15 } },
	{ pattern: /claude.*opus/i, price: { input: 5, output: 25 } },
	{ pattern: /gpt-4o-mini/i, price: { input: 0.15, output: 0.6 } },
	{ pattern: /gpt-4o/i, price: { input: 2.5, output: 10 } },
];

export function modelPrice(model: string | null | undefined): ModelPrice | null {
	if (!model) return null;
	for (const entry of PRICES) {
		if (entry.pattern.test(model)) return entry.price;
	}
	return null;
}

export type UsageNumbers = { input: number; output: number; total: number };

/** Read input/output/total from a provider usage object, tolerating the common
 *  field names, or null when there is nothing to show. */
export function usageNumbers(usage: Record<string, unknown> | null | undefined): UsageNumbers | null {
	if (!usage) return null;
	const input = Number(usage["inputTokens"] ?? usage["promptTokens"] ?? 0);
	const output = Number(usage["outputTokens"] ?? usage["completionTokens"] ?? 0);
	const total = Number(usage["totalTokens"] ?? input + output);
	if (!Number.isFinite(input) && !Number.isFinite(output) && !Number.isFinite(total)) return null;
	if (input === 0 && output === 0 && total === 0) return null;
	return { input, output, total };
}

/** Estimated USD for a usage object under the model's list price, or null when
 *  the model is unpriced or the usage has no token counts. */
export function estimateCost(
	model: string | null | undefined,
	usage: Record<string, unknown> | null | undefined,
): number | null {
	const price = modelPrice(model);
	const tokens = usageNumbers(usage);
	if (!price || !tokens) return null;
	return (tokens.input * price.input + tokens.output * price.output) / 1_000_000;
}

export function formatCost(cost: number): string {
	return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

export function formatTokens(count: number): string {
	return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}
