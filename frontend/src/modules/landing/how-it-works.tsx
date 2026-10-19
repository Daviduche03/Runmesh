import { Robot, User } from "@phosphor-icons/react"
import { container, sectionY } from "./constants"
import { Eyebrow } from "./primitives"

function RequestGraphic() {
	return (
		<div className="mt-auto pt-5">
			<div className="flex items-center">
				<span className="grid size-9 place-items-center rounded-full bg-[rgba(194,73,31,0.10)]">
					<Robot className="size-4 text-[var(--rm-accent)]" weight="fill" />
				</span>
				<span
					aria-hidden="true"
					className="mx-2 flex-1 border-t border-dashed border-[var(--rm-line-strong)]"
				/>
				<span className="grid size-9 place-items-center rounded-full bg-[var(--rm-panel-2)]">
					<User className="size-4 text-[var(--rm-fg-2)]" weight="fill" />
				</span>
			</div>
			<div className="mt-2 flex items-center justify-between">
				<span className="text-[11.5px] font-medium text-[var(--rm-fg)]">triage-bot</span>
				<span className="font-mono text-[11px] text-[var(--rm-faint)]">dev@helios.dev</span>
			</div>
			<span className="mt-3 inline-block rounded-md bg-[var(--rm-panel)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--rm-faint)]">
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
		<div className="mt-auto grid gap-3.5 pt-5">
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
		<div className="mt-auto pt-5">
			<div className="relative h-1.5 rounded-full bg-[var(--rm-panel-2)]">
				<div className="absolute inset-y-0 left-0 w-2/3 rounded-full bg-emerald-500" />
			</div>
			<div className="mt-2 flex justify-between text-[11px] font-medium text-[var(--rm-muted)]">
				<span>Queued</span>
				<span>Executing</span>
				<span>Receipted</span>
			</div>
			<span className="mt-3 inline-block rounded-md bg-[var(--rm-panel)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--rm-faint)]">
				retries · idempotency keys
			</span>
		</div>
	)
}

function GaugeGraphic() {
	return (
		<div className="relative mt-auto pt-5">
			<svg viewBox="0 0 120 66" className="mx-auto w-full max-w-[150px]">
				<defs>
					<linearGradient id="hiw-gauge" x1="0" y1="0" x2="1" y2="0">
						<stop offset="0%" stopColor="#6ee7b7" />
						<stop offset="100%" stopColor="#059669" />
					</linearGradient>
				</defs>
				<path
					d="M 10 60 A 50 50 0 0 1 110 60"
					fill="none"
					stroke="var(--rm-panel-2)"
					strokeWidth="10"
					strokeLinecap="round"
				/>
				<path
					d="M 10 60 A 50 50 0 0 1 110 60"
					fill="none"
					stroke="url(#hiw-gauge)"
					strokeWidth="10"
					strokeLinecap="round"
					strokeDasharray="148 157"
				/>
			</svg>
			<div className="absolute inset-x-0 bottom-3 text-center">
				<div className="font-display-sans text-[22px] font-medium tracking-[-0.02em] text-[var(--rm-fg)]">
					100%
				</div>
				<div className="text-[11px] text-[var(--rm-faint)]">attributable · 128 actions</div>
			</div>
			<div className="mt-2 flex items-center justify-center gap-4 text-[11px] text-[var(--rm-muted)]">
				<span className="flex items-center gap-1.5">
					<span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />
					traced
				</span>
				<span className="flex items-center gap-1.5">
					<span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--rm-line-strong)]" />
					untraced
				</span>
			</div>
		</div>
	)
}

const steps = [
	{
		step: "01",
		title: "The agent asks",
		question: "What does the agent want to do, and for whom?",
		Graphic: RequestGraphic,
	},
	{
		step: "02",
		title: "Policy decides",
		question: "Does it run, wait for the user, or wait for a person?",
		Graphic: DecisionGraphic,
	},
	{
		step: "03",
		title: "The action runs",
		question: "What happens when something breaks?",
		Graphic: PipelineGraphic,
	},
	{
		step: "04",
		title: "The receipt is written",
		question: "Who can trace it, and back to whom?",
		Graphic: GaugeGraphic,
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
					<h2 className="mt-5 text-balance font-sans text-[clamp(30px,4.2vw,52px)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--rm-fg)]">
						One request, end to end
					</h2>
					<p className="mt-5 max-w-[560px] text-pretty text-[17px] leading-7 text-[var(--rm-muted)]">
						Nothing to adopt and no sidecar to run. If your agent can make a request, it can act through
						Runmesh.
					</p>
				</div>

				<ol className="mt-14 grid items-stretch gap-6 md:grid-cols-2 xl:grid-cols-4">
					{steps.map(({ Graphic, ...item }) => (
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
							<Graphic />
						</li>
					))}
				</ol>
			</div>
		</section>
	)
}
