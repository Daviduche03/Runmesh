import { container, sectionY } from "./constants"
import { SectionHeading } from "./section-heading"
import { WindowImage } from "./window-image"

const primitives = [
	{
		index: "01",
		label: "Tasks",
		title: "Queue HTTP tasks to any webhook",
		copy: "Send JSON to any URL with UTC scheduling, idempotency keys, automatic retries, and a stored response.",
		base: "ui-2",
		span: "lg:col-span-5",
	},
	{
		index: "02",
		label: "Workflows",
		title: "Chain steps into a durable workflow",
		copy: "Build a graph, trigger it from a webhook or cron schedule, and pass data between steps with Jinja templates.",
		base: "ui-3",
		span: "lg:col-span-7",
	},
	{
		index: "03",
		label: "Connect",
		title: "One identity across the apps you build",
		copy: "Users sign in with email OTP or OAuth; your integrations get scoped grants instead of long-lived secrets.",
		base: "ui-7",
		span: "lg:col-span-7",
	},
	{
		index: "04",
		label: "Runs & webhooks",
		title: "See every run, replay every webhook",
		copy: "Follow each task through queued, running, completed, or failed. Failed outbound webhooks go to a dead-letter store you can replay.",
		base: "ui-6",
		span: "lg:col-span-5",
	},
]

export function Primitives() {
	return (
		<section id="primitives" className={`scroll-mt-14 border-b border-[var(--rm-line)] ${sectionY}`}>
			<div className={container}>
				<SectionHeading index="01" label="What Runmesh does" title="Tasks, workflows, and identity in one place">
					Four pieces you would otherwise wire together yourself: a task queue, a workflow runner, a user identity
					layer, and a dashboard to watch all of it.
				</SectionHeading>

				<div className="mt-14 grid gap-px bg-[var(--rm-line)] lg:grid-cols-12">
					{primitives.map((item) => (
						<article
							className={`group flex flex-col gap-6 bg-[var(--rm-bg)] p-6 lg:p-8 ${item.span}`}
							key={item.index}
						>
							<div className="flex items-baseline justify-between gap-4">
								<span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--rm-accent)]">
									{item.index} / {item.label}
								</span>
							</div>
							<WindowImage
								base={item.base}
								alt={item.title}
								imgClassName="transition-transform duration-500 ease-out group-hover:-translate-y-0.5"
							/>
							<div className="mt-auto max-w-[540px]">
								<h3 className="font-display text-[20px] font-medium leading-[1.2] tracking-[-0.02em] text-[var(--rm-fg)]">
									{item.title}
								</h3>
								<p className="mt-2 text-[15px] leading-6 text-[var(--rm-muted)]">{item.copy}</p>
							</div>
						</article>
					))}
				</div>
			</div>
		</section>
	)
}
