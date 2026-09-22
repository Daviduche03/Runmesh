import type { FormSelectOption } from "@/components/form-select";

/**
 * The action vocabulary, in two tiers evaluated on different paths.
 *
 * - **Providers** (`google`, `github`, …) are what the engine matches at
 *   issuance — `build_action_identity` derives the action from the connection
 *   row. The set is dynamic (`GET /api/v1/connect/providers`).
 * - **Tool actions** (`provider.action`) are what the engine matches on the
 *   call path — `tool_invoke` builds the context from the registered tool row.
 *   They come from `GET /api/v1/tools`.
 *
 * Scopes are a third vocabulary, and not the same thing: a scope is what the
 * *provider* enforces (coarse, carried by the connection's token, e.g.
 * `gmail.send`); a tool action is what *we* enforce at the call boundary.
 * `buildScopeValueOptions` serves the `scope` condition field.
 */
export type RegisteredToolAction = {
	action: string;
	kind: string;
	provider: string;
};

export type ProviderCatalogEntry = {
	id: string;
	scopes: string[];
};

export type ValueOption = FormSelectOption<string>;

const PROVIDER_GROUP = "Providers · issuance (coarse)";
const CURRENT_GROUP = "Current value";

/**
 * Options for an `action` condition — the capability being decided.
 *
 * One vocabulary, qualified: `provider.scope` (`google.gmail.send`). A grant
 * requests scopes, so issuance candidates are each requested scope qualified
 * by the provider — the same string a tool action carries on the call path.
 * That way one rule fires at both tiers. The provider itself is kept as a
 * coarse fallback. Unknown saved values are preserved.
 */
export function buildActionValueOptions(args: {
	providers: ProviderCatalogEntry[];
	tools: RegisteredToolAction[];
	current: string;
}): ValueOption[] {
	const options: ValueOption[] = [];
	const seen = new Set<string>();
	const push = (option: ValueOption) => {
		if (seen.has(option.value)) return;
		seen.add(option.value);
		options.push(option);
	};

	for (const provider of args.providers) {
		for (const scope of provider.scopes ?? []) {
			const value = `${provider.id}.${scope}`;
			push({ label: value, value, group: `${provider.id} · scopes` });
		}
	}
	for (const provider of args.providers) {
		push({ label: provider.id, value: provider.id, group: PROVIDER_GROUP });
	}

	const byProvider = new Map<string, RegisteredToolAction[]>();
	for (const tool of args.tools) {
		if (!tool.action) continue;
		const key = tool.provider || "other";
		const list = byProvider.get(key) ?? [];
		list.push(tool);
		byProvider.set(key, list);
	}
	for (const [provider, list] of byProvider) {
		for (const tool of list) {
			push({ label: tool.action, value: tool.action, group: `${provider} · tools` });
		}
	}

	if (args.current) push({ label: args.current, value: args.current, group: CURRENT_GROUP });
	return options;
}


