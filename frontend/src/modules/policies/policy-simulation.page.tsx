"use client";

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CapabilityMatrix } from "@/modules/policies/components/capability-matrix";
import { CoverageGaps } from "@/modules/policies/components/coverage-gaps";
import { DecisionExplain } from "@/modules/policies/components/decision-explain";
import { usePoliciesStore } from "@/lib/stores/policies-store";
import { actionDot, actionLabel } from "@/lib/policy";
import { cn } from "@/lib/utils";

const LEGEND = ["allow", "consent", "escalate", "deny"] as const;

export function PolicySimulationPage() {
	const navigate = useNavigate();
	const matrix = usePoliciesStore((s) => s.matrix);
	const matrixLoading = usePoliciesStore((s) => s.matrixLoading);
	const fetchMatrix = usePoliciesStore((s) => s.fetchMatrix);
	const gaps = usePoliciesStore((s) => s.gaps);
	const gapsTotal = usePoliciesStore((s) => s.gapsTotal);
	const gapsLoading = usePoliciesStore((s) => s.gapsLoading);
	const fetchGaps = usePoliciesStore((s) => s.fetchGaps);

	useEffect(() => {
		fetchMatrix();
		fetchGaps();
	}, [fetchMatrix, fetchGaps]);

	const policyOff = matrix !== null && !matrix.configured;

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h1 className="font-display text-[22px] font-medium tracking-[-0.02em] text-balance">Simulation</h1>
				<p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">
					Evaluate a request against the rules, see what each agent resolves to, and find what the
					default is silently blocking. Nothing here runs for real.
				</p>
			</div>

			<Card>
				<CardHeader>
					<div className="space-y-1.5">
						<CardTitle className="text-balance">Explain a decision</CardTitle>
						<CardDescription className="text-pretty">
							Every decision shows the rule that made it, the inputs it read, and what would change
							the outcome.
						</CardDescription>
					</div>
				</CardHeader>
				<CardContent>
					<DecisionExplain />
				</CardContent>
			</Card>

			<div className="grid gap-3">
				<div className="flex flex-wrap items-baseline justify-between gap-3">
					<h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
						Current state
					</h2>
				</div>

				<Card>
					<CardHeader>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="space-y-1.5">
								<CardTitle className="text-balance">Effective capability</CardTitle>
								<CardDescription className="text-pretty">
									Per agent and action, with resource, user, and amount unset.
								</CardDescription>
							</div>
							<div className="flex flex-wrap items-center gap-3">
								{LEGEND.map((decision) => (
									<span className="flex items-center gap-1.5" key={decision}>
										<span className={cn("size-1.5 rounded-full", actionDot[decision])} aria-hidden />
										<span className="text-[11px] text-muted-foreground">{actionLabel[decision]}</span>
									</span>
								))}
							</div>
						</div>
					</CardHeader>
					{policyOff ? (
						<CardContent className="px-0">
							<p className="px-4 pb-2 text-[12.5px] leading-5 text-muted-foreground text-pretty">
								Policy is off, so nothing is gated — enable an enforcing rule to see the matrix
								resolve.
							</p>
						</CardContent>
					) : (
						<CardContent className="px-0">
							<CapabilityMatrix data={matrix} loading={matrixLoading} />
						</CardContent>
					)}
				</Card>

				<Card>
					<CardHeader>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="space-y-1.5">
								<CardTitle className="text-balance">Coverage gaps</CardTitle>
								<CardDescription className="text-pretty">
									Default-deny hides what it blocks. These actions were requested and matched no
									rule.
								</CardDescription>
							</div>
							<span className="text-[12px] text-muted-foreground tabular-nums">
								{gapsLoading ? "…" : `${gapsTotal} blocked by default`}
							</span>
						</div>
					</CardHeader>
					<CardContent className="px-0">
						<CoverageGaps
							gaps={gaps}
							loading={gapsLoading}
							onAddRule={(gap) =>
								navigate(`/policies?action=${encodeURIComponent(gap.action)}`)
							}
						/>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
