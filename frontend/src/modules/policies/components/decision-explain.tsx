"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormSelect } from "@/components/form-select";
import { cn } from "@/lib/utils";
import {
	actionLabel,
	actionText,
	type PolicyAction,
	type PolicyRequest,
} from "@/lib/policy";
import { usePoliciesStore, type EvaluateResult } from "@/lib/stores/policies-store";
import { useAgentsStore } from "@/lib/stores/agents-store";
import { useProvidersStore } from "@/lib/stores/providers-store";
import { useToolsStore } from "@/lib/stores/tools-store";
import { ArrowRightIcon, CheckIcon, MinusIcon, PlayIcon } from "lucide-react";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="grid gap-1.5">
			<span className="text-[12px] text-muted-foreground">{label}</span>
			{children}
		</div>
	);
}

const statusDot: Record<string, string> = {
	matched: "bg-emerald-400",
	shadow: "bg-sky-400",
	skipped: "bg-muted-foreground/30",
	disabled: "bg-muted-foreground/30",
	"not-reached": "bg-muted-foreground/20",
};

export function DecisionExplain() {
	const evaluate = usePoliciesStore((s) => s.evaluate);

	const agents = useAgentsStore((s) => s.agents);
	const fetchAgents = useAgentsStore((s) => s.fetch);
	const providers = useProvidersStore((s) => s.providers);
	const fetchProviders = useProvidersStore((s) => s.fetch);
	const tools = useToolsStore((s) => s.tools);
	const fetchTools = useToolsStore((s) => s.fetch);

	const [request, setRequest] = useState<PolicyRequest>({
		agent: "",
		action: "",
		resource: "",
		user: "",
		amount: "",
	});
	const [result, setResult] = useState<EvaluateResult | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		fetchAgents();
		fetchProviders();
		fetchTools();
	}, [fetchAgents, fetchProviders, fetchTools]);

	// Agents are matched by label, so the option value is the name.
	const agentOptions = useMemo(
		() => agents.map((agent) => ({ label: agent.name, value: agent.name })),
		[agents]
	);
	const actionOptions = useMemo(() => {
		const actions = providers.map((provider) => provider.id);
		for (const tool of tools) {
			if (tool.action && !actions.includes(tool.action)) actions.push(tool.action);
		}
		return actions.map((action) => ({ label: action, value: action }));
	}, [providers, tools]);

	// Fill a sensible default from the real options, derived rather than stored
	// so no effect is needed to keep it in sync.
	const agentValue = request.agent || agentOptions[0]?.value || "";
	const actionValue = request.action || actionOptions[0]?.value || "";

	const patch = (next: Partial<PolicyRequest>) => setRequest((current) => ({ ...current, ...next }));
	const label = useMemo(
		() => (result ? (result.rule ? `#${result.rule.priority} · ${result.rule.name}` : "default") : null),
		[result]
	);
	const ready = agentValue !== "" && actionValue !== "";

	const run = async () => {
		setFailed(false);
		const outcome = await evaluate({ ...request, agent: agentValue, action: actionValue });
		if (!outcome) {
			setFailed(true);
			setResult(null);
			return;
		}
		setResult(outcome);
	};

	return (
		<div className="grid gap-4">
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
				<Field label="Agent">
					<FormSelect
						options={agentOptions}
						value={agentValue}
						placeholder={agentOptions.length ? "Select agent…" : "No agents"}
						onChange={(value) => patch({ agent: value })}
					/>
				</Field>
				<Field label="Action">
					<FormSelect
						options={actionOptions}
						value={actionValue}
						placeholder={actionOptions.length ? "Select action…" : "No actions"}
						onChange={(value) => patch({ action: value })}
					/>
				</Field>
				<Field label="Resource">
					<Input
						value={request.resource}
						onChange={(e) => patch({ resource: e.target.value })}
						placeholder="repo:org/name"
						className="font-mono text-[12px]"
					/>
				</Field>
				<Field label="On behalf of">
					<Input
						value={request.user}
						onChange={(e) => patch({ user: e.target.value })}
						placeholder="user@example.com"
						className="font-mono text-[12px]"
					/>
				</Field>
				<Field label="Amount (USD)">
					<Input
						value={request.amount}
						onChange={(e) => patch({ amount: e.target.value })}
						placeholder="0"
						className="font-mono text-[12px]"
					/>
				</Field>
			</div>

			<div className="flex flex-wrap items-center gap-3">
				<Button size="sm" disabled={!ready} onClick={() => void run()}>
					<PlayIcon className="me-1.5 size-3.5" />
					Evaluate
				</Button>
				{failed ? <span className="text-[12px] text-red-400">Evaluation failed. Try again.</span> : null}
			</div>

			{result ? (
				<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
					<div className="grid content-start gap-2 rounded-[4px] border border-border bg-muted/30 p-4">
						<span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
							Decision
						</span>
						<span className={cn("font-display text-[18px] font-medium", actionText[result.decision])}>
							{actionLabel[result.decision]}
						</span>
						<span className="font-mono text-[11.5px] text-muted-foreground">{label}</span>
						<p className="text-[12.5px] leading-5 text-muted-foreground">{result.reason}</p>
						<div className="mt-1 flex items-start gap-1.5 border-t border-border pt-3">
							<ArrowRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
							<span className="text-[12.5px] leading-5">{result.changeHint}</span>
						</div>
					</div>

					<div className="rounded-[4px] border border-border">
						<div className="border-b border-border px-4 py-2">
							<span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
								Rules evaluated in order
							</span>
						</div>
						<ul className="divide-y divide-border">
							{result.steps.map((step) => (
								<li className="flex items-start gap-3 px-4 py-2.5" key={step.id}>
									<span className="mt-1.5 flex size-4 shrink-0 items-center justify-center">
										{step.status === "matched" ? (
											<CheckIcon className="size-3.5 text-emerald-400" />
										) : (
											<span className={cn("size-1.5 rounded-full", statusDot[step.status])} aria-hidden />
										)}
									</span>
									<span className="grid min-w-0 flex-1 gap-0.5">
										<span className="flex items-center gap-2">
											<span className="font-mono text-[11px] text-muted-foreground">#{step.priority}</span>
											<span className="truncate text-[12.5px]">{step.name}</span>
											<span className={cn("font-mono text-[11px]", actionText[step.action as PolicyAction])}>
												{actionLabel[step.action as PolicyAction]}
											</span>
										</span>
										<span className="truncate text-[11.5px] text-muted-foreground">{step.detail}</span>
									</span>
								</li>
							))}
						</ul>
						<div className="flex items-center gap-2 border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
							<MinusIcon className="size-3" />
							Unmatched falls to default deny — enforced once an enforcing rule is enabled.
						</div>
					</div>
				</div>
			) : (
				<span className="text-[12px] text-muted-foreground">Pick a request and evaluate it.</span>
			)}
		</div>
	);
}
