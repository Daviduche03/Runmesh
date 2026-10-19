import { useState } from "react"
import { CaretDown } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"
import { container } from "./constants"
import { Eyebrow } from "./primitives"

const faqs = [
	{
		q: "Is this an agent framework?",
		a: "No. Runmesh governs the actions an agent wants to take; it does not build agents or run models. Your agent keeps its runtime, and anything with a side effect goes through Runmesh first.",
	},
	{
		q: "Do I have to change how my agent works?",
		a: "Only where it acts. If a call can change something outside your sandbox, route it through Runmesh so the action is authorized and recorded. Everything else keeps working as it does today.",
	},
	{
		q: "Who approves an action?",
		a: "Whoever is the authority for it: your policy by default, the end user the action is taken on behalf of, or an operator. Policy can forbid and escalate; only the end user's own agreement can approve on their behalf.",
	},
	{
		q: "What happens if a credential leaks?",
		a: "It expires. Every credential carries a lifetime and a use count, so a leaked one is self-limiting. You can revoke it at any time, and the trail shows where it was used.",
	},
	{
		q: "Can I run it myself?",
		a: "Yes. It is a single process with a single database file, and it runs on any machine you can run a container on. No managed control plane required, and the whole thing is MIT licensed.",
	},
	{
		q: "What does it not do?",
		a: "It cannot enforce anything on an action it never sees. An agent that copies data out by hand leaves no trace for any control plane to inspect. The model assumes that: least privilege per action, and a human above a threshold.",
	},
]

export function Faq() {
	const [open, setOpen] = useState<number | null>(0)

	return (
		<section id="faq" className="scroll-mt-16 border-t border-[var(--rm-line)] py-20 lg:py-28">
			<div className={container}>
				<div className="grid gap-12 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-20">
					<div>
						<Eyebrow>FAQ</Eyebrow>
						<h2 className="mt-5 text-balance font-display-sans text-[clamp(28px,3.6vw,44px)] font-medium leading-[1.08] tracking-[-0.03em] text-[var(--rm-fg)]">
							The questions worth asking
						</h2>
						<p className="mt-5 text-pretty text-[16px] leading-7 text-[var(--rm-muted)]">
							Including the one about what it cannot do.
						</p>
					</div>

					<div className="divide-y divide-[var(--rm-line)] border-y border-[var(--rm-line)]">
						{faqs.map((faq, i) => {
							const isOpen = open === i
							return (
								<div key={faq.q}>
									<button
										type="button"
										onClick={() => setOpen(isOpen ? null : i)}
										aria-expanded={isOpen}
										className="flex w-full items-start justify-between gap-6 py-5 text-left transition-[color] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-accent)]"
									>
										<span className="text-[16.5px] font-medium tracking-[-0.01em] text-[var(--rm-fg)]">
											{faq.q}
										</span>
										<CaretDown
											className={cn(
												"mt-0.5 size-4 shrink-0 text-[var(--rm-faint)] transition-transform duration-200 ease-[var(--ease-out)]",
												isOpen && "rotate-180"
											)}
											weight="bold"
										/>
									</button>
									<div
										className={cn(
											"grid transition-[grid-template-rows,opacity] duration-250 ease-[var(--ease-out)]",
											isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
										)}
									>
										<div className="overflow-hidden">
											<p className="max-w-[640px] pb-6 pr-10 text-pretty text-[15.5px] leading-7 text-[var(--rm-muted)]">
												{faq.a}
											</p>
										</div>
									</div>
								</div>
							)
						})}
					</div>
				</div>
			</div>
		</section>
	)
}
