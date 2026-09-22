import { container, sectionY } from "./constants"
import { SectionHeading } from "./section-heading"
import { ProductShot, type ProductShotVariant } from "@/components/product-shot"

const primitives: {
	index: string
	label: string
	title: string
	copy: string
	shot: ProductShotVariant
}[] = [
	{
		index: "01",
		label: "Identity",
		title: "Every agent gets an identity, not a shared key",
		copy: "Register agents and tie every action to the agent, task, or workflow run that requested it. Know exactly who did what.",
		shot: "agents",
	},
	{
		index: "02",
		label: "Access",
		title: "Scoped, revocable, time-limited credentials",
		copy: "Mint tokens bound to an agent, a task, a resource, and an expiry. No long-lived secrets, no all-or-nothing scopes.",
		shot: "grants",
	},
	{
		index: "03",
		label: "Approvals",
		title: "Human in the loop, by policy",
		copy: "Decide what runs freely and what waits for a person — a token, a refund, a destructive action — before it happens.",
		shot: "approvals",
	},
	{
		index: "04",
		label: "Execution",
		title: "Run the work, durably",
		copy: "HTTP tasks, scheduled jobs, and multi-step workflows with retries, idempotency, and replay — on the same queues.",
		shot: "actions",
	},
]

export function Primitives() {
	return (
		<section id="primitives" className={`scroll-mt-14 border-b border-[var(--rm-line)] ${sectionY}`}>
			<div className={container}>
				<SectionHeading index="01" label="What Runmesh does" title="Identity, access, and control in one plane">
					The four things you would otherwise stitch together yourself — agent identity, scoped credentials,
					approval gates, and durable execution — behind one API and one dashboard.
				</SectionHeading>

				<div className="mt-14 grid gap-px bg-[var(--rm-line)] md:grid-cols-2">
					{primitives.map((item) => (
						<article className="group flex flex-col gap-6 bg-[var(--rm-bg)] p-6 lg:p-8" key={item.index}>
							<div className="flex items-baseline justify-between gap-4">
								<span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--rm-accent)]">
									{item.index} / {item.label}
								</span>
							</div>
							<div className="border border-[var(--rm-line)] bg-[var(--rm-panel)] p-3">
								<ProductShot
									variant={item.shot}
									className="transition-transform duration-200 ease-[var(--ease-out)] group-hover:-translate-y-0.5"
								/>
							</div>
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
