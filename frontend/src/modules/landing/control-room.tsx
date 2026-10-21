import { Link } from "react-router-dom"
import { ArrowRight } from "@phosphor-icons/react"
import { container } from "./constants"
import { AuditStage, GrantsStage, PoliciesStage } from "./control-room-stages"
import { Eyebrow } from "./primitives"

const features = [
	{
		id: "grants",
		eyebrow: "Grants",
		title: "Consent, scoped to the byte",
		copy: "A grant names the agent, the user it acts for, the scope, the resource, and the expiry. Revoke one without touching the rest. See every grant and who issued it.",
		points: [
			"Scope down to a single repo or label",
			"Use counts and TTLs enforced server-side",
			"Revoke without revoking everything else",
		],
		Stage: GrantsStage,
		href: "/grants",
		linkLabel: "See grants",
	},
	{
		id: "policies",
		eyebrow: "Policies",
		title: "Decide what runs freely",
		copy: "Ordered rules that auto-approve, require consent, escalate to a human, or deny. First match wins. Every decision is written to the ledger, and a gate that never rejects is not a gate.",
		points: [
			"Allow, consent, escalate, or deny, in that order",
			"Log-only rules for watching before enforcing",
			"Coverage gaps and a capability matrix",
		],
		Stage: PoliciesStage,
		href: "/policies",
		linkLabel: "See policies",
	},
	{
		id: "audit",
		eyebrow: "Audit",
		title: "Every action, on the record",
		copy: "Threads group an agent session. Runs group one operation. Every event traces back to the human it was taken on behalf of. It is exportable, replayable, and explainable.",
		points: [
			"Agent → grant → action → result in one stream",
			"Attribution down to the individual and the tool",
			"CSV export and dead-letter replay",
		],
		Stage: AuditStage,
		href: "/audit",
		linkLabel: "See the audit trail",
	},
]

export function ControlRoom() {
	return (
		<section id="control-room" className="scroll-mt-16 border-t border-[var(--rm-line)] py-20 lg:py-28">
			<div className={container}>
				<div className="max-w-[720px]">
					<Eyebrow>The control room</Eyebrow>
					<h2 className="mt-5 text-balance font-display-sans text-[clamp(30px,4.2vw,52px)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--rm-fg)]">
						The place your team runs agents from
					</h2>
					<p className="mt-5 max-w-[560px] text-pretty text-[17px] leading-7 text-[var(--rm-muted)]">
						The same controls your engineers use to run agents in production, not a separate admin tool
						bolted on top.
					</p>
				</div>

				<div className="mt-14 grid gap-4 lg:mt-16 lg:gap-6">
					{features.map((feature, i) => {
						const flipped = i % 2 === 1
						return (
							<article
								className="rounded-2xl border border-[var(--rm-line)] bg-white p-2 lg:p-3"
								key={feature.id}
							>
								<div className="grid gap-0 lg:grid-cols-2 lg:items-stretch">
									<div className={`min-w-0 ${flipped ? "lg:order-2" : ""}`}>
										<feature.Stage />
									</div>
									<div
										className={`flex min-w-0 flex-col justify-center px-5 py-8 lg:px-10 lg:py-12 ${
											flipped ? "lg:order-1" : ""
										}`}
									>
										<div className="max-w-[440px]">
											<Eyebrow>{feature.eyebrow}</Eyebrow>
											<h3 className="mt-4 text-balance font-display-sans text-[clamp(23px,2.3vw,30px)] font-medium leading-[1.12] tracking-[-0.025em] text-[var(--rm-fg)]">
												{feature.title}
											</h3>
											<p className="mt-4 text-pretty text-[15.5px] leading-7 text-[var(--rm-muted)]">
												{feature.copy}
											</p>
											<ul className="mt-6 grid gap-2.5">
												{feature.points.map((point) => (
													<li
														className="flex gap-2.5 text-[14px] leading-5 text-[var(--rm-fg-2)]"
														key={point}
													>
														<span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--rm-accent)]" />
														{point}
													</li>
												))}
											</ul>
											<Link
												to={feature.href}
												className="mt-7 inline-flex items-center gap-1.5 text-[14.5px] font-medium text-[var(--rm-accent)] no-underline transition-[opacity] duration-150 ease-[var(--ease-out)] hover:opacity-75"
											>
												{feature.linkLabel}
												<ArrowRight className="size-4" weight="bold" />
											</Link>
										</div>
									</div>
								</div>
							</article>
						)
					})}
				</div>
			</div>
		</section>
	)
}
