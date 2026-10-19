import { container } from "./constants"
import { Eyebrow } from "./primitives"

const steps = [
	{
		step: "01",
		title: "The agent asks",
		copy: "An agent requests access for one specific action, on behalf of one specific user. The request carries no authority of its own.",
	},
	{
		step: "02",
		title: "Policy decides",
		copy: "Your rules decide whether it runs, whether the user has to agree, or whether a person has to look at it first.",
	},
	{
		step: "03",
		title: "The action runs",
		copy: "The scoped credential is spent, the work is queued, and retries and failures are handled for you.",
	},
	{
		step: "04",
		title: "The receipt is written",
		copy: "Agent, grant, approver, action, result — one trail, traceable to the human it was taken on behalf of.",
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
					<h2 className="mt-5 text-balance font-display-sans text-[clamp(30px,4.2vw,52px)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--rm-fg)]">
						One request, end to end
					</h2>
					<p className="mt-5 max-w-[560px] text-pretty text-[17px] leading-7 text-[var(--rm-muted)]">
						Nothing to adopt and no sidecar to run. If your agent can make a request, it can act through
						Runmesh.
					</p>
				</div>

				<ol className="mt-14 grid gap-px overflow-hidden rounded-xl border border-[var(--rm-line)] bg-[var(--rm-line)] md:grid-cols-2 xl:grid-cols-4">
					{steps.map((item) => (
						<li className="flex flex-col gap-3 bg-[var(--rm-bg)] p-6 lg:p-7" key={item.step}>
							<span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--rm-accent)]">
								{item.step}
							</span>
							<h3 className="font-sans text-[19px] font-medium tracking-[-0.02em] text-[var(--rm-fg)]">
								{item.title}
							</h3>
							<p className="text-[14.5px] leading-6 text-[var(--rm-muted)]">{item.copy}</p>
						</li>
					))}
				</ol>
			</div>
		</section>
	)
}
