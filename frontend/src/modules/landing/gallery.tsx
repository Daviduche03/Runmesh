import { cn } from "@/lib/utils"
import { container, sectionY } from "./constants"
import { SectionHeading } from "./section-heading"
import { ProductShot, type ProductShotVariant } from "@/components/product-shot"

const screens: {
	shot: ProductShotVariant
	label: string
	title: string
	copy: string
}[] = [
	{
		shot: "agents",
		label: "Agents",
		title: "Agents and the access they hold",
		copy: "See every agent, the grants behind it, and the tasks it is running right now.",
	},
	{
		shot: "grants",
		label: "Grants",
		title: "Consent, scoped to the byte",
		copy: "Scope, resource, expiry, and use count on every token — revoke without revoking everything.",
	},
	{
		shot: "audit",
		label: "Audit",
		title: "Every action, on the record",
		copy: "Threads of runs and events, each traced back to the human it was taken on behalf of.",
	},
	{
		shot: "policies",
		label: "Policies",
		title: "Decide what runs freely",
		copy: "Ordered rules that auto-approve, require consent, escalate, or deny — auditable at the source.",
	},
]

function ScreenCard({ shot, label, title, copy }: (typeof screens)[number]) {
	return (
		<article className="group relative overflow-hidden border border-[var(--rm-line)]">
			<div className="bg-[var(--rm-panel)] p-5 sm:p-7">
				<ProductShot
					variant={shot}
					className={cn("transition-transform duration-200 ease-[var(--ease-out)] group-hover:-translate-y-1")}
				/>
			</div>
			<div className="border-t border-[var(--rm-line)] px-5 py-5 sm:px-7">
				<div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--rm-accent)]">{label}</div>
				<h3 className="mt-2 font-display text-[18px] font-medium tracking-[-0.02em] text-[var(--rm-fg)]">{title}</h3>
				<p className="mt-1.5 max-w-[440px] text-[14px] leading-6 text-[var(--rm-muted)]">{copy}</p>
			</div>
		</article>
	)
}

export function Gallery() {
	return (
		<section id="interface" className={`scroll-mt-14 border-b border-[var(--rm-line)] ${sectionY}`}>
			<div className={container}>
				<SectionHeading index="03" label="Control room" title="The place your team runs agents from">
					The same screens your engineers use to operate agents in production — not a separate admin tool bolted on
					top.
				</SectionHeading>

				<div className="mt-14 grid gap-4 md:grid-cols-2">
					{screens.map((screen) => (
						<ScreenCard key={screen.shot} {...screen} />
					))}
				</div>
			</div>
		</section>
	)
}
