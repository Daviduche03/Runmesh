"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/segmented-control";
import { FormSelect } from "@/components/form-select";
import { SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { apiGet } from "@/lib/api";
import { buildActionValueOptions, type ProviderCatalogEntry } from "@/lib/actions";
import { useAgentsStore } from "@/lib/stores/agents-store";
import { useToolsStore } from "@/lib/stores/tools-store";
import {
	actionText,
	formatMs,
	oversightVerdict,
	rejectionRate,
	ruleRego,
	toneText,
	type PolicyAction,
	type PolicyCondition,
	type PolicyRule,
	type Reversibility,
} from "@/lib/policy";

const fieldOptions = ["action", "agent", "resource", "user", "amount", "time"] as const;
const operatorOptions = ["is", "is not", "contains", ">", "<", "within"] as const;

/** Keep a saved field visible even if it is no longer offered (e.g. `scope`). */
function fieldSelectOptionsFor(current: string) {
	const base = fieldOptions.map((option) => ({ label: option, value: option }));
	if (base.some((option) => option.value === current)) return base;
	return [...base, { label: current, value: current }];
}

const actionOptions = [
	{ label: "Allow", value: "allow" },
	{ label: "Consent", value: "consent" },
	{ label: "Escalate", value: "escalate" },
	{ label: "Deny", value: "deny" },
] as const;

const modeOptions = [
	{ label: "Enforce", value: "enforce" },
	{ label: "Log-only", value: "log-only" },
] as const;

const reversibilityOptions = [
	{ label: "Reversible", value: "reversible" },
	{ label: "Has undo", value: "undoable" },
	{ label: "Irreversible", value: "irreversible" },
] as const;

function Block({
	title,
	hint,
	focal,
	children,
}: {
	title: string;
	hint?: string;
	focal?: boolean;
	children: ReactNode;
}) {
	return (
		<section
			className={cn(
				"grid gap-3.5",
				focal && "rounded-lg border border-border bg-muted/20 p-3.5"
			)}
		>
			<div className="flex items-baseline justify-between gap-3">
				<h3 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
				{hint ? <span className="text-[11px] text-muted-foreground/70">{hint}</span> : null}
			</div>
			<div className="grid gap-3">{children}</div>
		</section>
	);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<div className="grid gap-1.5">
			<span className="text-[12px] text-muted-foreground">{label}</span>
			{children}
			{hint ? <p className="text-[11px] text-muted-foreground/70">{hint}</p> : null}
		</div>
	);
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
	return (
		<div className="grid gap-0.5 rounded-[4px] border border-border px-3 py-2">
			<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
			<span className={cn("text-[14px] tabular-nums", tone)}>{value}</span>
		</div>
	);
}

const operatorSelectOptions = operatorOptions.map((option) => ({ label: option, value: option }));

/** Value options for fields the engine matches against a closed set.
 *  `agent` is a known agent id; everything else dynamic
 *  (resource, user, amount, time) stays free text. `action` options come from
 *  the formal catalog in `@/lib/actions` (providers enforceable now,
 *  tool actions explicitly disabled until the tool-call path evaluates them). */
/** Agent options show the human name; the id stays the submitted value
 *  because that is what the engine matches against. */
function agentValueOptions(
	agents: Array<{ id: string; name: string }>,
	current: string,
): Array<{ label: ReactNode; value: string }> {
	// The engine compares the condition against the agent *label* (see
	// build_grant_context / tool_invoke), so the value must be the name.
	// Names are not unique; policy cannot tell same-named agents apart.
	const options: Array<{ label: ReactNode; value: string }> = agents.map((agent) => ({
		label: agent.name,
		value: agent.name,
	}));
	if (current && !agents.some((agent) => agent.name === current))
		options.push({ label: current, value: current });
	return options;
}

export function PolicyRuleDetail({
	rule,
	onSave,
	onDelete,
	saving,
	serverError,
}: {
	rule: PolicyRule;
	onSave?: (updates: {
		name: string;
		enabled: boolean;
		conditions: PolicyCondition[];
		action: PolicyAction;
		mode: "enforce" | "log-only";
		reversibility: Reversibility;
		caps: { spend?: string; maxUses?: string; ttl?: string };
	}) => Promise<string | null>;
	onDelete?: () => Promise<string | null>;
	saving?: boolean;
	serverError?: string | null;
}) {
	const [enabled, setEnabled] = useState(rule.enabled);
	const [name, setName] = useState(rule.name);
	const [conditions, setConditions] = useState<PolicyCondition[]>(rule.conditions);
	const [action, setAction] = useState<PolicyAction>(rule.action);
	const [mode, setMode] = useState<"enforce" | "log-only">(rule.mode);
	const [reversibility, setReversibility] = useState<Reversibility>(rule.reversibility);
	const [spend, setSpend] = useState(rule.caps.spend ?? "");
	const [maxUses, setMaxUses] = useState(rule.caps.maxUses ?? "");
	const [ttl, setTtl] = useState(rule.caps.ttl ?? "");
	const [dirty, setDirty] = useState(false);
	const [providers, setProviders] = useState<ProviderCatalogEntry[] | null>(null);
	const agents = useAgentsStore((s) => s.agents);
	const fetchAgents = useAgentsStore((s) => s.fetch);
	const tools = useToolsStore((s) => s.tools);
	const fetchTools = useToolsStore((s) => s.fetch);

	useEffect(() => {
		fetchAgents();
		fetchTools();
		let cancelled = false;
		apiGet<ProviderCatalogEntry[]>("/api/v1/connect/providers")
			.then(({ data }) => {
				if (!cancelled) setProviders(data);
			})
			.catch(() => {
				if (!cancelled) setProviders(null);
			});
		return () => {
			cancelled = true;
		};
	}, [fetchAgents, fetchTools]);

	const mark = () => setDirty(true);
	const verdict = oversightVerdict(rule);
	const rate = rejectionRate(rule);
	const isNew = rule.id === "new";

	const setCondition = (index: number, patch: Partial<PolicyCondition>) => {
		setConditions((prev) => prev.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)));
		mark();
	};

	return (
		<>
			<SheetHeader className="gap-3">
				<div className="flex items-start gap-3">
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
								{isNew ? "New rule" : "Rule"}
							</span>
							<span className={cn("font-mono text-[11px]", actionText[action])}>#{rule.priority}</span>
						</div>
						<SheetTitle className="sr-only">{name || "New rule"}</SheetTitle>
						<Input
							aria-label="Rule name"
							value={name}
							placeholder="Name this rule"
							onChange={(e) => {
								setName(e.target.value);
								mark();
							}}
							className="mt-1 h-auto rounded-none border-0 bg-transparent px-0 text-[17px] font-medium tracking-[-0.01em] shadow-none focus-visible:ring-0 dark:bg-transparent"
						/>
					</div>
					<button
						type="button"
						aria-pressed={enabled}
						onClick={() => {
							setEnabled((value) => !value);
							mark();
						}}
						className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium transition-[border-color,background-color,color] duration-150 ease-[var(--ease-out)] hover:bg-muted/50 active:scale-[0.97] motion-reduce:active:scale-100"
					>
						<span
							className={`size-1.5 rounded-full ${enabled ? "bg-emerald-400" : "bg-muted-foreground/40"}`}
							aria-hidden
						/>
						<span className={enabled ? "text-emerald-400" : "text-muted-foreground"}>
							{enabled ? "Enabled" : "Disabled"}
						</span>
					</button>
				</div>
				<SheetDescription className="text-[12.5px] leading-5">{rule.description}</SheetDescription>
			</SheetHeader>

			<div className="flex-1 space-y-6 overflow-y-auto px-4 pb-4 pt-1">
				<Block title="Rule" hint="what this decides" focal>
					<div className="grid gap-2">
						<span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/80">If</span>
						{conditions.map((condition, index) => {
							const actionValueOptions = providers
								? buildActionValueOptions({ providers, tools, current: condition.value })
								: null;
							const agentOptions =
								agents.length > 0 ? agentValueOptions(agents, condition.value) : null;
							const selectableOptions =
								condition.field === "action"
									? actionValueOptions
									: condition.field === "agent"
										? agentOptions
										: null;
							return (
								<div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2" key={index}>
									<FormSelect
										options={fieldSelectOptionsFor(condition.field)}
										value={condition.field as (typeof fieldOptions)[number]}
										onChange={(value) => setCondition(index, { field: value, value: "" })}
									/>
									<FormSelect
										options={operatorSelectOptions}
										value={condition.operator as (typeof operatorOptions)[number]}
										onChange={(value) => setCondition(index, { operator: value })}
									/>
									{selectableOptions ? (
										<FormSelect
											options={selectableOptions}
											value={condition.value}
											placeholder="Select value…"
											className="font-mono text-[12px]"
											onChange={(value) => setCondition(index, { value })}
										/>
									) : (
										<Input
											value={condition.value}
											onChange={(e) => setCondition(index, { value: e.target.value })}
											className="font-mono text-[12px]"
										/>
									)}
								</div>
							);
						})}
						<p className="text-[11px] text-muted-foreground/70">All conditions must match.</p>
					</div>
					<div className="grid gap-2">
						<span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/80">Then</span>
						<SegmentedControl
							options={actionOptions}
							value={action}
							onChange={(value) => {
								setAction(value);
								mark();
							}}
						/>
					</div>
				</Block>

				<Block title="Behavior" hint="how the rule acts">
					<Field label="Mode" hint="Log-only watches before it acts.">
						<SegmentedControl
							options={modeOptions}
							value={mode}
							onChange={(value) => {
								setMode(value);
								mark();
							}}
						/>
					</Field>
					<Field label="Reversibility">
						<SegmentedControl
							options={reversibilityOptions}
							value={reversibility}
							onChange={(value) => {
								setReversibility(value);
								mark();
							}}
						/>
					</Field>
				</Block>

				<Block title="Limits" hint="bounds even when allowed">
					<div className="grid grid-cols-3 gap-2">
						<Field label="Spend cap" hint="USD">
							<Input
								value={spend}
								onChange={(e) => {
									setSpend(e.target.value);
									mark();
								}}
								placeholder="—"
								className="font-mono text-[12px]"
							/>
						</Field>
						<Field label="Max uses" hint="count">
							<Input
								value={maxUses}
								onChange={(e) => {
									setMaxUses(e.target.value);
									mark();
								}}
								placeholder="—"
								className="font-mono text-[12px]"
							/>
						</Field>
						<Field label="TTL" hint="minutes">
							<Input
								value={ttl}
								onChange={(e) => {
									setTtl(e.target.value);
									mark();
								}}
								placeholder="—"
								className="font-mono text-[12px]"
							/>
						</Field>
					</div>
				</Block>

				{isNew ? null : (
					<Block title="Oversight" hint="is this gate doing work">
						<div className={cn("flex items-start gap-2 rounded-[4px] border border-border px-3 py-2.5", verdict.tone === "danger" && "border-red-500/30")}>
							<span className={cn("mt-1 size-1.5 shrink-0 rounded-full", verdict.tone === "danger" ? "bg-red-400" : verdict.tone === "warn" ? "bg-amber-400" : verdict.tone === "ok" ? "bg-emerald-400" : "bg-muted-foreground/40")} aria-hidden />
							<span className="grid gap-0.5">
								<span className={cn("text-[12.5px] font-medium", toneText[verdict.tone])}>{verdict.label}</span>
								<span className="text-[11.5px] leading-4 text-muted-foreground">{verdict.detail}</span>
							</span>
						</div>
						<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
							<Metric label="Decided" value={rule.decided.toLocaleString()} />
							<Metric label="Escalated" value={String(rule.escalated)} tone={rule.escalated > 0 ? "text-amber-400" : undefined} />
							<Metric
								label="Rejected"
								value={rate === null ? "—" : `${rule.rejections} · ${(rate * 100).toFixed(0)}%`}
								tone={rate !== null && rate < 0.05 ? "text-red-400" : undefined}
							/>
							<Metric label="Median review" value={rule.escalated > 0 ? formatMs(rule.medianReviewMs) : "—"} />
						</div>
					</Block>
				)}

				<details className="group rounded-lg border border-border">
					<summary className="cursor-pointer list-none px-3.5 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground transition-colors duration-150 ease-[var(--ease-out)] hover:text-foreground">
						Compiled policy
					</summary>
					<pre className="overflow-x-auto border-t border-border p-3 font-mono text-[11px] leading-5 text-muted-foreground">
						{ruleRego({ ...rule, conditions, action })}
					</pre>
				</details>

				{rule.history.length > 0 ? (
					<Block title="History">
						<ul className="divide-y divide-border">
							{rule.history.map((entry, index) => (
								<li className="grid gap-0.5 py-2.5" key={index}>
									<span className="text-[13px]">{entry.change}</span>
									<span className="font-mono text-[11px] text-muted-foreground">
										{entry.at} · {entry.by}
									</span>
								</li>
							))}
						</ul>
					</Block>
				) : null}
			</div>

			{serverError ? (
				<p className="px-4 pb-2 text-[12px] text-red-400">{serverError}</p>
			) : null}
			<SheetFooter className="flex-row items-center justify-between gap-2">
				<span className="text-[11px] text-muted-foreground">{dirty ? "Unsaved changes" : "Up to date"}</span>
				<div className="flex gap-2">
					{onDelete && !isNew ? (
						<Button variant="outline" size="sm" disabled={saving} onClick={() => void onDelete()}>
							Delete
						</Button>
					) : null}
					<Button variant="outline" size="sm" disabled={!dirty || saving} onClick={() => setDirty(false)}>
						Discard
					</Button>
					<Button
						size="sm"
						disabled={!dirty || saving || !onSave}
						onClick={() =>
							void onSave?.({
								name,
								enabled,
								conditions,
								action,
								mode,
								reversibility,
								caps: {
									...(spend ? { spend } : {}),
									...(maxUses ? { maxUses } : {}),
									...(ttl ? { ttl } : {}),
								},
							}).then((message) => {
								if (!message) setDirty(false);
							})
						}
					>
						{isNew ? "Create rule" : "Save changes"}
					</Button>
				</div>
			</SheetFooter>
		</>
	);
}
