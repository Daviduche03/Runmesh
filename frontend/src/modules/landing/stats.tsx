import { container } from "./constants"

const stats = [
	{
		value: "0",
		label: "long-lived credentials",
		detail: "every one is scoped, expiring, and revocable",
	},
	{
		value: "3",
		label: "who can approve",
		detail: "policy, the end user, or an operator",
	},
	{
		value: "100%",
		label: "attributable",
		detail: "every action traces back to a principal",
	},
	{
		value: "1",
		label: "place to look",
		detail: "one view of every agent, grant, policy and receipt",
	},
]

export function Stats() {
	return (
		<section className="border-t border-[var(--rm-line)] bg-[var(--rm-ink)] py-16 lg:py-20">
			<div className={container}>
				<div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
					{stats.map((stat) => (
						<div key={stat.label}>
							<div className="font-display-serif text-[clamp(44px,5.4vw,66px)] font-light leading-none tracking-[-0.035em] text-[var(--rm-ink-fg)] tabular-nums">
								{stat.value}
							</div>
							<div className="mt-3 text-[15px] font-medium text-[var(--rm-ink-2)]">{stat.label}</div>
							<p className="mt-1.5 text-[13.5px] leading-5 text-[var(--rm-ink-muted)]">{stat.detail}</p>
						</div>
					))}
				</div>
			</div>
		</section>
	)
}
