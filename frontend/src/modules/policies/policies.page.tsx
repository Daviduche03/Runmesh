"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/modules/dashboard/components/stat-card";
import { PolicyRulesTable } from "@/modules/policies/components/policy-rules-table";
import { PolicyRuleDetail } from "@/modules/policies/components/policy-rule-detail";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { oversightVerdict, type PolicyRule } from "@/lib/policy";
import { policyDraftRule } from "@/lib/policy-data";
import { usePoliciesStore, type BackendPolicyRule } from "@/lib/stores/policies-store";
import { PlusIcon, SlidersHorizontalIcon } from "lucide-react";
import EmptyState from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

function toPolicyRule(rule: BackendPolicyRule): PolicyRule {
	return {
		id: rule.id,
		priority: rule.priority,
		name: rule.name,
		description: rule.description,
		enabled: rule.enabled,
		conditions: rule.conditions,
		action: rule.action,
		scope: rule.scope,
		mode: rule.mode,
		caps: {
			...(rule.caps.spend ? { spend: rule.caps.spend } : {}),
			...(rule.caps.maxUses ? { maxUses: rule.caps.maxUses } : {}),
			...(rule.caps.ttl ? { ttl: rule.caps.ttl } : {}),
		},
		reversibility: rule.reversibility,
		decided: rule.decided,
		escalated: rule.escalated,
		approvals: rule.approvals,
		rejections: rule.rejections,
		medianReviewMs: rule.medianReviewMs,
		rego: rule.rego,
		history: [],
	};
}

export function PoliciesPage() {
	const backendRules = usePoliciesStore((s) => s.rules);
	const loading = usePoliciesStore((s) => s.loading);
	const saving = usePoliciesStore((s) => s.saving);
	const fetchRules = usePoliciesStore((s) => s.fetch);
	const createRule = usePoliciesStore((s) => s.create);
	const updateRule = usePoliciesStore((s) => s.update);
	const removeRule = usePoliciesStore((s) => s.remove);
	const [selectedRule, setSelectedRule] = useState<PolicyRule | null>(null);
	const [serverError, setServerError] = useState<string | null>(null);
	const [searchParams, setSearchParams] = useSearchParams();

	useEffect(() => {
		fetchRules();
	}, [fetchRules]);

	// "Add rule" from the Simulation page's coverage gaps opens a draft that
	// already targets the action that fell to the default. Derived from the
	// URL rather than copied into state, so no effect is needed.
	const draftAction = searchParams.get("action");
	const draftFromParam = useMemo<PolicyRule | null>(
		() =>
			draftAction
				? {
						...policyDraftRule,
						description: `Draft targeting ${draftAction}, which matched no rule.`,
						conditions: [{ field: "action", operator: "is", value: draftAction }],
					}
				: null,
		[draftAction]
	);
	const openRule = selectedRule ?? draftFromParam;

	const closeSheet = () => {
		setSelectedRule(null);
		setServerError(null);
		if (draftAction) setSearchParams({}, { replace: true });
	};

	const policyRules = backendRules.map(toPolicyRule);

	const escalatedToday = policyRules.reduce((total, rule) => total + rule.escalated, 0);
	const rejections = policyRules.reduce((total, rule) => total + rule.rejections, 0);
	const approvals = policyRules.reduce((total, rule) => total + rule.approvals, 0);
	const reviewed = approvals + rejections;
	const deadGates = policyRules.filter(
		(rule) => rule.enabled && oversightVerdict(rule).tone === "danger"
	).length;
	// Auto-decided = enforced allow decisions. Real, from the decision ledger.
	const autoDecided = policyRules
		.filter((rule) => rule.action === "allow")
		.reduce((total, rule) => total + rule.decided, 0);
	const enforcing = policyRules.filter((rule) => rule.enabled && rule.mode === "enforce").length;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
				<div>
					<h1 className="font-display text-[22px] font-medium tracking-[-0.02em]">Policies</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						{enforcing > 0
							? "Default-deny. Unmatched requests are blocked; rules decide what runs freely, what reaches a human, and what never runs."
							: "Policy is off until you enable an enforcing rule. Issuance proceeds normally today."}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="inline-flex items-center rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
						{enforcing > 0 ? "Default: deny" : "Policy off"}
					</span>
					<Button
						onClick={() => {
							setServerError(null);
							setSelectedRule(policyDraftRule);
						}}
					>
						<PlusIcon className="me-1.5 size-4" />
						New rule
					</Button>
				</div>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard label="Auto-decided" value={String(autoDecided)} footnote="no human involved" />
				<StatCard label="Escalated today" value={String(escalatedToday)} footnote="spent human attention" />
				<StatCard
					label="Rejection rate"
					value={reviewed ? `${Math.round((rejections / reviewed) * 100)}%` : "—"}
					footnote={`${rejections} of ${reviewed} reviews`}
				/>
				<StatCard label="Dead gates" value={String(deadGates)} footnote="escalating, never rejecting" />
			</div>

			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="space-y-1.5">
							<CardTitle>Rules &amp; oversight</CardTitle>
							<CardDescription>
								First match wins. A gate that never rejects is not a gate. Select a rule to edit it.
							</CardDescription>
						</div>
						<span className="text-[12px] text-muted-foreground">
							{policyRules.filter((rule) => rule.enabled).length} of {policyRules.length} enabled
						</span>
					</div>
				</CardHeader>
				<CardContent className="px-0">
					{loading && policyRules.length === 0 ? (
						<div className="grid gap-2 px-4 py-2">
							{[0, 1, 2].map((index) => (
								<Skeleton className="h-12 w-full rounded-[4px]" key={index} />
							))}
						</div>
					) : policyRules.length > 0 ? (
						<PolicyRulesTable rules={policyRules} onSelect={setSelectedRule} />
					) : (
						<div className="px-4 pb-4">
							<EmptyState
								title="No rules yet"
								description="Policy stays off until you enable an enforcing rule. Create the first one."
								icon={<SlidersHorizontalIcon className="size-6 text-muted-foreground" />}
							/>
						</div>
					)}
				</CardContent>
			</Card>

				<Sheet
				open={!!openRule}
				onOpenChange={(open) => {
					if (!open) closeSheet();
				}}
			>
				<SheetContent side="right" className="w-full sm:max-w-lg">
					{openRule ? (
						<PolicyRuleDetail
							key={openRule.id}
							rule={openRule}
							saving={saving}
							serverError={serverError}
							onSave={async (updates) => {
								setServerError(null);
								const message =
									openRule.id === "new"
										? await createRule({
												name: updates.name,
												description: openRule.description,
												conditions: updates.conditions,
												action: updates.action,
												scope: openRule.scope,
												mode: updates.mode,
												caps: updates.caps,
												reversibility: updates.reversibility,
												enabled: updates.enabled,
											})
										: await updateRule(openRule.id, updates);
								setServerError(message);
								if (!message) closeSheet();
								return message;
							}}
							onDelete={async () => {
								setServerError(null);
								const message = await removeRule(openRule.id);
								setServerError(message);
								if (!message) closeSheet();
								return message;
							}}
						/>
					) : null}
				</SheetContent>
			</Sheet>
		</div>
	);
}
