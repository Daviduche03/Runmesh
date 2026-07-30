import { sectionPadding } from "./constants"
import { PurposeVisual } from "./visuals/purpose-visual"
import { AgentsVisual } from "./visuals/agents-visual"
import { TriageVisual } from "./visuals/triage-visual"
import { SpeedVisual } from "./visuals/speed-visual"
import { motion } from "framer-motion"

const bentoCards = [
	{
		fig: "FIG 0.2",
		title: "Durable actions",
		copy: "Turn agent tool calls into queued tasks with retries, idempotency, cancellation, and stored outcomes.",
		visual: <PurposeVisual />,
	},
	{
		fig: "FIG 0.3",
		title: "Agent workflows",
		copy: "Chain steps, trigger runs from webhooks or schedules, and pass results forward as the agent waits and resumes.",
		visual: <AgentsVisual />,
	},
	{
		fig: "FIG 0.4",
		title: "Delegated access",
		copy: "Issue scoped, auditable access so agents can act for users without carrying long-lived secrets.",
		visual: <TriageVisual />,
	},
	{
		fig: "FIG 0.5",
		title: "Workspace context",
		copy: "Sync project files to a dev-aware cloud workspace so humans and coding agents work from the same context.",
		visual: <SpeedVisual />,
	},
]

export function BentoSpecies() {
	return (
		<section id="features" className={`scroll-mt-14 border-b border-[#15181d] ${sectionPadding}`}>
			<div className="mx-auto w-[min(1256px,calc(100%_-_48px))]">
				<motion.h2
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1] }}
					className="max-w-[940px] text-balance text-[clamp(40px,4.2vw,52px)] font-[590] leading-[1.08] tracking-[-0.045em] text-white"
				>
					One product, four agentic primitives.{" "}
					<span className="text-[#8f949e]">
						Run actions, orchestrate workflows, delegate access, and give agents real project context without stitching together separate tools.
					</span>
				</motion.h2>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="mt-32 grid grid-cols-1 border-[#202329] md:grid-cols-2 md:border-x xl:grid-cols-4"
				>
					{bentoCards.map((card) => {
						const { fig, title, copy, visual } = card
						return (
							<article key={fig} className="group flex min-h-[470px] flex-col border-[#202329] md:border-r md:last:border-r-0">
								<div className="px-8 font-mono text-[12px] tracking-[0.16em] text-[#383c44]">{fig}</div>
								<div className="flex flex-1 items-center justify-center py-10 opacity-80 transition-opacity duration-300 group-hover:opacity-100">
									{visual}
								</div>
								<div className="px-8 pb-1">
									<h3 className="mb-3 text-[16px] font-[590] tracking-[-0.01em] text-[#d8dce3]">{title}</h3>
									<p className="max-w-[310px] text-[16px] leading-6 text-[#8f949e]">{copy}</p>
								</div>
							</article>
						)
					})}
				</motion.div>
			</div>
		</section>
	)
}
