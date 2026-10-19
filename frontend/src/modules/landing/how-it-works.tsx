import { container } from "./constants"
import { Eyebrow } from "./primitives"

const steps = [
	{
		step: "01",
		title: "The agent asks",
		copy: "An agent requests a token for a specific action, on behalf of a specific user. The request carries no authority of its own.",
		mono: "POST /api/v1/connect/token",
	},
	{
		step: "02",
		title: "Policy decides",
		copy: "Rules are evaluated at issuance. Allow, consent, escalate, or deny — and the decision, with its reason, lands in the ledger.",
		mono: "policy_decisions → allow",
	},
	{
		step: "03",
		title: "The action runs",
		copy: "The scoped token is spent on a durable queue. Retries, idempotency, and replay are handled for you.",
		mono: "POST /api/v1/tasks → 200",
	},
	{
		step: "04",
		title: "The receipt is written",
		copy: "Agent, grant, approver, action, result. One thread, traceable to the human it was taken on behalf of.",
		mono: "connect_audit_events → recorded",
	},
]

export function HowItWorks() {
	return (
		<section
			id="how-it-works"
			className="scroll-mt-16 border-t border-[var(--rm-line)] bg-[var(--rm-panel)] py-20 lg:py-28"
		>
			<div className={container}>
				<div className="max-w-[720px]">
					<Eyebrow>How it works</Eyebrow>
					<h2 className="mt-5 text-balance font-display text-[clamp(30px,4.2vw,52px)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--rm-fg)]">
						One request, end to end
					</h2>
					<p className="mt-5 max-w-[560px] text-pretty text-[17px] leading-7 text-[var(--rm-muted)]">
						No SDK to adopt, no sidecar to run. If your agent can make an HTTP request, it can act through
						Runmesh.
					</p>
				</div>

				<ol className="mt-14 grid gap-px overflow-hidden rounded-xl border border-[var(--rm-line)] bg-[var(--rm-line)] md:grid-cols-2 xl:grid-cols-4">
					{steps.map((item) => (
						<li className="flex flex-col gap-3 bg-[var(--rm-bg)] p-6 lg:p-7" key={item.step}>
							<span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--rm-accent)]">
								{item.step}
							</span>
							<h3 className="font-display text-[19px] font-medium tracking-[-0.02em] text-[var(--rm-fg)]">
								{item.title}
							</h3>
							<p className="text-[14.5px] leading-6 text-[var(--rm-muted)]">{item.copy}</p>
							<code className="mt-auto block overflow-x-auto rounded-[6px] border border-[var(--rm-line)] bg-[var(--rm-panel-2)] px-3 py-2 font-mono text-[12px] whitespace-nowrap text-[var(--rm-fg-2)]">
								{item.mono}
							</code>
						</li>
					))}
				</ol>
			</div>
		</section>
	)
}
