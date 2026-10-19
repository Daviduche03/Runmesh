import { Robot, User } from "@phosphor-icons/react"
import { container, sectionY } from "./constants"
import { Eyebrow } from "./primitives"

function RequestGraphic() {
	return (
		<div>
			<div className="flex items-center">
				<span className="grid size-10 place-items-center rounded-full bg-[rgba(194,73,31,0.10)]">
					<Robot className="size-[18px] text-[var(--rm-accent)]" weight="fill" />
				</span>
				<span
					aria-hidden="true"
					className="mx-2.5 flex-1 border-t border-dashed border-[var(--rm-line-strong)]"
				/>
				<span className="grid size-10 place-items-center rounded-full bg-[var(--rm-panel-2)]">
					<User className="size-[18px] text-[var(--rm-fg-2)]" weight="fill" />
				</span>
			</div>
			<div className="mt-2 flex items-center justify-between">
				<span className="text-[12.5px] font-medium text-[var(--rm-fg)]">triage-bot</span>
				<span className="font-mono text-[11.5px] text-[var(--rm-faint)]">dev@helios.dev</span>
			</div>
			<span className="mt-3 inline-block rounded-md bg-[var(--rm-panel)] px-3 py-1.5 font-mono text-[11px] text-[var(--rm-faint)]">
				issues:write · acme/api
			</span>
		</div>
	)
}

function DecisionGraphic() {
	const decisions = [
		{ label: "Allow", pct: "62%", width: "62%", fill: "bg-emerald-500" },
		{ label: "Consent", pct: "25%", width: "25%", fill: "bg-amber-400" },
		{ label: "Escalate", pct: "13%", width: "13%", fill: "bg-[var(--rm-accent)]" },
	]
	return (
		<div className="grid gap-3">
			{decisions.map((d) => (
				<div key={d.label}>
					<div className="flex items-baseline justify-between">
						<span className="text-[13px] font-medium text-[var(--rm-fg)]">{d.label}</span>
						<span className="font-mono text-[11px] text-[var(--rm-faint)]">{d.pct}</span>
					</div>
					<div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--rm-panel-2)]">
						<div className={`h-full rounded-full ${d.fill}`} style={{ width: d.width }} />
					</div>
				</div>
			))}
		</div>
	)
}

function PipelineGraphic() {
	return (
		<div>
			<div className="relative h-2 rounded-full bg-[var(--rm-panel-2)]">
				<div className="absolute inset-y-0 left-0 w-2/3 rounded-full bg-emerald-500" />
			</div>
			<div className="mt-2 flex justify-between text-[12px] font-medium text-[var(--rm-muted)]">
				<span>Queued</span>
				<span>Executing</span>
				<span>Receipted</span>
			</div>
			<span className="mt-3 inline-block rounded-md bg-[var(--rm-panel)] px-3 py-1.5 font-mono text-[11px] text-[var(--rm-faint)]">
				agent → grant → approver
			</span>
		</div>
	)
}

const steps = [
	{
		index: "01",
		title: "The agent asks",
		copy: "The agent states what it wants to do. Runmesh ties the request to an identity and a task, so nothing arrives anonymous.",
		Graphic: RequestGraphic,
		points: ["Every request carries an agent id", "Scoped to one action and one resource"],
	},
	{
		index: "02",
		title: "Policy decides",
		copy: "Rules evaluate before anything executes. Policy auto-approves by default, the end user consents, a human handles exceptions.",
		Graphic: DecisionGraphic,
		points: ["First-match-wins policy rules", "Consent and escalation built in"],
	},
	{
		index: "03",
		title: "The action runs",
		copy: "Durable execution with retries and idempotency — then a receipt written down: which agent, on whose behalf, approved by whom.",
		Graphic: PipelineGraphic,
		points: ["Retries and idempotency keys", "One trail: agent → grant → approver → result"],
	},
]

export function HowItWorks() {
	return (
		<section
			id="how-it-works"
			className={`scroll-mt-16 border-t border-[var(--rm-line)] bg-[var(--rm-panel)] ${sectionY}`}
		>
			<div className={container}>
				<div className="max-w-[720px]">
					<Eyebrow>How it works</Eyebrow>
					<h2 className="mt-5 text-balance font-display-sans text-[clamp(30px,4.2vw,52px)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--rm-fg)]">
						One request, end to end
					</h2>
					<p className="mt-5 max-w-[560px] text-pretty text-[17px] leading-7 text-[var(--rm-muted)]">
						Nothing to adopt and no sidecar to run. If your agent can make a request, it can act through
						Runmesh.
					</p>
				</div>

				<div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-[var(--rm-line)] bg-[var(--rm-line)] md:grid-cols-3">
					{steps.map(({ Graphic, ...item }) => (
						<article className="flex flex-col gap-6 bg-white p-7 lg:p-8" key={item.index}>
							<span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--rm-accent)]">
								{item.index}
							</span>
							<h3 className="font-display-sans text-[24px] font-medium tracking-[-0.02em] text-[var(--rm-fg)]">
								{item.title}
							</h3>
							<p className="text-[15px] leading-6 text-[var(--rm-muted)]">{item.copy}</p>
							<div className="flex h-[104px] flex-col justify-end">
								<Graphic />
							</div>
							<ul className="mt-auto grid gap-2.5 border-t border-[var(--rm-line)] pt-5">
								{item.points.map((point) => (
									<li
										className="flex gap-2.5 text-[13.5px] leading-5 text-[var(--rm-fg-2)]"
										key={point}
									>
										<span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--rm-accent)]" />
										{point}
									</li>
								))}
							</ul>
						</article>
					))}
				</div>
			</div>
		</section>
	)
}
