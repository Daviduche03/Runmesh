import { container, sectionY } from "./constants"
import { Eyebrow } from "./primitives"

const steps = [
	{
		step: "01",
		title: "The agent asks",
		question: "What does the agent want to do, and for whom?",
		rows: [
			{ tone: "accent", label: "triage-bot", note: "acme/api" },
			{ tone: "gray", label: "On behalf of", note: "dev@helios.dev" },
		],
	},
	{
		step: "02",
		title: "Policy decides",
		question: "Does it run, wait for the user, or wait for a person?",
		rows: [
			{ tone: "green", label: "allow", note: "auto-approved" },
			{ tone: "accent", label: "escalate", note: "human review" },
		],
	},
	{
		step: "03",
		title: "The action runs",
		question: "What happens when something breaks?",
		rows: [
			{ tone: "green", label: "executed", note: "durable queue" },
			{ tone: "gray", label: "retried", note: "idempotency keys" },
		],
	},
	{
		step: "04",
		title: "The receipt is written",
		question: "Who can trace it, and back to whom?",
		rows: [
			{ tone: "green", label: "agent → grant → approver", note: "result" },
			{ tone: "gray", label: "ledger", note: "immutable · exportable" },
		],
	},
]

const dotTone: Record<string, string> = {
	accent: "bg-[var(--rm-accent)]",
	green: "bg-emerald-500",
	gray: "bg-[var(--rm-line-strong)]",
}

export function HowItWorks() {
	return (
		<section
			id="how-it-works"
			className={`scroll-mt-16 border-t border-[var(--rm-line)] bg-[var(--rm-panel)] ${sectionY}`}
		>
			<div className={container}>
				<div className="max-w-[720px]">
					<Eyebrow>How it works</Eyebrow>
					<h2 className="mt-5 text-balance font-sans text-[clamp(30px,4.2vw,52px)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--rm-fg)]">
						One request, end to end
					</h2>
					<p className="mt-5 max-w-[560px] text-pretty text-[17px] leading-7 text-[var(--rm-muted)]">
						Nothing to adopt and no sidecar to run. If your agent can make a request, it can act through
						Runmesh.
					</p>
				</div>

				<ol className="mt-14 grid items-stretch gap-6 md:grid-cols-2 xl:grid-cols-4">
					{steps.map((item) => (
						<li
							className="flex flex-col rounded-xl border border-[var(--rm-line)] bg-white p-6"
							key={item.step}
						>
							<span className="text-[12px] font-medium tracking-[0.1em] text-[var(--rm-accent)]">
								{item.step}
							</span>
							<h3 className="mt-3 font-display-sans text-[17px] font-medium tracking-[-0.01em] text-[var(--rm-fg)]">
								{item.title}
							</h3>
							<p className="mt-1.5 text-[14px] leading-5 text-[var(--rm-muted)]">{item.question}</p>

							<ul className="mt-auto grid gap-2 pt-5">
								{item.rows.map((row) => (
									<li
										className="flex items-center gap-2.5 rounded-lg bg-[var(--rm-panel)] px-3 py-2"
										key={row.note}
									>
										<span
											aria-hidden="true"
											className={`size-2 shrink-0 rounded-full ${dotTone[row.tone]}`}
										/>
										<span className="truncate text-[13px] font-medium text-[var(--rm-fg)]">
											{row.label}
										</span>
										<span className="ml-auto shrink-0 font-mono text-[11px] text-[var(--rm-faint)]">
											{row.note}
										</span>
									</li>
								))}
							</ul>
						</li>
					))}
				</ol>
			</div>
		</section>
	)
}
