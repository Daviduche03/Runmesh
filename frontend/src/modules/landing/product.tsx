import { container, sectionY } from "./constants"
import { DotField, Eyebrow } from "./primitives"

const verbs = [
	{
		index: "01",
		title: "Authorize",
		copy: "Every action is checked before it runs. Policy decides by default; the end user consents; a human only handles the exceptions policy could not decide.",
		points: ["Policy engine with first-match-wins rules", "Consent flow for delegated access", "Escalation when a gate needs a person"],
		lit: [0, 1, 2, 3, 12, 13, 14, 15, 24, 25, 26, 27, 36, 37, 38, 39, 48, 49, 50, 51],
	},
	{
		index: "02",
		title: "Execute",
		copy: "Scoped, time-limited credentials that die on their own. Durable work with retries, idempotency, and replay — so a failure never becomes a mystery.",
		points: ["One credential per agent, action, resource, window", "Short lifetimes and use caps by default", "Durable queues, and outbound webhooks you can replay"],
		lit: [10, 11, 20, 21, 22, 30, 31, 32, 33, 40, 41, 50, 51, 52, 53, 60, 61, 62, 71, 72],
	},
	{
		index: "03",
		title: "Record",
		copy: "A receipt for everything. Which agent, on whose behalf, with what scope, approved by whom — and what it actually did.",
		points: ["One trail: agent → grant → action → result", "Every decision written down, with its reason", "Exportable, grouped by the session it belongs to"],
		lit: [0, 10, 11, 20, 21, 22, 30, 31, 40, 41, 50, 60, 61, 70, 71, 72, 73, 80, 81, 82],
	},
]

export function Product() {
	return (
		<section id="product" className={`scroll-mt-16 border-t border-[var(--rm-line)] ${sectionY}`}>
			<div className={container}>
				<div className="max-w-[720px]">
					<Eyebrow>What Runmesh does</Eyebrow>
					<h2 className="mt-5 text-balance font-sans text-[clamp(30px,4.2vw,52px)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--rm-fg)]">
						Three verbs, done as one thing
					</h2>
					<p className="mt-5 max-w-[560px] text-pretty text-[17px] leading-7 text-[var(--rm-muted)]">
						Most agent stacks give you execution and hope the rest sorts itself. Runmesh bundles the three
						things you would otherwise stitch together — and they only work together.
					</p>
				</div>

				<div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-[var(--rm-line)] bg-[var(--rm-line)] md:grid-cols-3">
					{verbs.map((verb) => (
						<article
							className="flex flex-col gap-6 bg-[var(--rm-panel)] p-7 lg:p-8"
							key={verb.index}
						>
							<div className="flex items-start justify-between gap-4">
								<span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--rm-faint)]">
									{verb.index}
								</span>
								<DotField
									cols={9}
									rows={9}
									size={5}
									gap={3}
									lit={verb.lit}
									className="shrink-0"
								/>
							</div>
							<h3 className="font-sans text-[24px] font-medium tracking-[-0.02em] text-[var(--rm-fg)]">
								{verb.title}
							</h3>
							<p className="text-[15px] leading-6 text-[var(--rm-muted)]">{verb.copy}</p>
							<ul className="mt-auto grid gap-2.5 border-t border-[var(--rm-line)] pt-5">
								{verb.points.map((point) => (
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
