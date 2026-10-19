import { ArrowClockwise, ArrowUpRight, Check, Receipt, Robot, User } from "@phosphor-icons/react"
import { container, sectionY } from "./constants"
import { Eyebrow } from "./primitives"

function RequestGraphic() {
	return (
		<div className="overflow-hidden rounded-lg border border-[var(--rm-line)] bg-white shadow-[0_1px_2px_rgba(16,18,55,0.06)]">
			<div className="flex items-center gap-2.5 border-b border-[var(--rm-line)] px-3 py-2.5">
				<span className="grid size-6 shrink-0 place-items-center rounded-full bg-[rgba(194,73,31,0.10)]">
					<Robot className="size-3.5 text-[var(--rm-accent)]" weight="fill" />
				</span>
				<span className="min-w-0">
					<span className="block truncate text-[12.5px] font-medium leading-4 text-[var(--rm-fg)]">
						triage-bot
					</span>
					<span className="block truncate font-mono text-[10.5px] leading-4 text-[var(--rm-faint)]">
						act_01J9X7 · just now
					</span>
				</span>
				<span className="ml-auto shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
					requested
				</span>
			</div>
			<div className="px-3 py-2 font-mono text-[11px] leading-5 text-[var(--rm-fg)]">
				issues:write <span className="text-[var(--rm-faint)]">→ acme/api #4821</span>
			</div>
			<div className="flex gap-1.5 px-3 pb-3">
				<span className="rounded bg-[var(--rm-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--rm-muted)]">
					scope: repo
				</span>
				<span className="rounded bg-[var(--rm-panel)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--rm-muted)]">
					ttl: 10m
				</span>
			</div>
		</div>
	)
}

function DecisionGraphic() {
	const rules = [
		{
			Icon: Check,
			badge: "bg-emerald-50 text-emerald-600",
			name: "repo in allowlist",
			pill: "allow",
			pillCls: "bg-emerald-50 text-emerald-700",
		},
		{
			Icon: User,
			badge: "bg-amber-50 text-amber-600",
			name: "write:issues needs a user",
			pill: "consent",
			pillCls: "bg-amber-50 text-amber-700",
		},
		{
			Icon: ArrowUpRight,
			badge: "bg-[rgba(194,73,31,0.10)] text-[var(--rm-accent)]",
			name: "outside standing grant",
			pill: "escalate",
			pillCls: "bg-[rgba(194,73,31,0.10)] text-[var(--rm-accent)]",
		},
	]
	return (
		<div className="overflow-hidden rounded-lg border border-[var(--rm-line)] bg-white shadow-[0_1px_2px_rgba(16,18,55,0.06)]">
			{rules.map(({ Icon, badge, name, pill, pillCls }, i) => (
				<div
					className={`flex items-center gap-2.5 px-3 py-2 ${i > 0 ? "border-t border-[var(--rm-line)]" : ""}`}
					key={name}
				>
					<span className={`grid size-6 shrink-0 place-items-center rounded-full ${badge}`}>
						<Icon className="size-3.5" weight="bold" />
					</span>
					<span className="truncate text-[12.5px] text-[var(--rm-fg-2)]">{name}</span>
					<span
						className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${pillCls}`}
					>
						{pill}
					</span>
				</div>
			))}
		</div>
	)
}

function PipelineGraphic() {
	const events = [
		{
			Icon: Check,
			badge: "bg-emerald-50 text-emerald-600",
			name: "Executed",
			detail: "200 · 412ms",
			when: "2s ago",
		},
		{
			Icon: ArrowClockwise,
			badge: "bg-amber-50 text-amber-600",
			name: "Retried",
			detail: "replay #2",
			when: "9s ago",
		},
		{
			Icon: Receipt,
			badge: "bg-[var(--rm-panel)] text-[var(--rm-fg-2)]",
			name: "Receipted",
			detail: "ledger #88231",
			when: "11s ago",
		},
	]
	return (
		<div className="overflow-hidden rounded-lg border border-[var(--rm-line)] bg-white shadow-[0_1px_2px_rgba(16,18,55,0.06)]">
			{events.map(({ Icon, badge, name, detail, when }, i) => (
				<div
					className={`flex items-center gap-2.5 px-3 py-2 ${i > 0 ? "border-t border-[var(--rm-line)]" : ""}`}
					key={name}
				>
					<span className={`grid size-6 shrink-0 place-items-center rounded-full ${badge}`}>
						<Icon className="size-3.5" weight="bold" />
					</span>
					<span className="truncate text-[12.5px] font-medium text-[var(--rm-fg)]">{name}</span>
					<span className="truncate font-mono text-[10.5px] text-[var(--rm-faint)]">{detail}</span>
					<span className="ml-auto shrink-0 font-mono text-[10.5px] text-[var(--rm-faint)]">
						{when}
					</span>
				</div>
			))}
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
			className={`scroll-mt-16 border-t border-[var(--rm-line)] ${sectionY}`}
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
						<article className="flex flex-col gap-6 bg-[var(--rm-panel)] p-7 lg:p-8" key={item.index}>
							<span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--rm-accent)]">
								{item.index}
							</span>
							<h3 className="font-display-sans text-[24px] font-medium tracking-[-0.02em] text-[var(--rm-fg)]">
								{item.title}
							</h3>
							<p className="text-[15px] leading-6 text-[var(--rm-muted)]">{item.copy}</p>
							<div className="flex h-[148px] flex-col justify-end">
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
