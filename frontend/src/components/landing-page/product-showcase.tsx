import { sectionPadding } from "./constants"
import { TriageVisual } from "./visuals/triage-visual"
import { MiniDashboardVisual } from "./visuals/mini-dashboard-visual"
import { AgentsVisual } from "./visuals/agents-visual"
import { LinearBentoCard } from "./bento-card"
import { motion } from "framer-motion"

export function ProductShowcase() {
	return (
		<section id="lifecycle" className={`scroll-mt-14 border-b border-[#15181d] ${sectionPadding}`}>
			<div className="mx-auto w-[min(1256px,calc(100%_-_48px))]">
				<motion.h2
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1] }}
					className="mb-16 max-w-[940px] ml-auto text-right text-balance text-[clamp(40px,4.2vw,52px)] font-[590] leading-[1.08] tracking-[-0.045em] text-white"
				>
					Every endpoint tells you what's happening.{" "}
					<span className="text-[#8f949e]">
						The Task API lets you create, inspect, and manage tasks across every stage of their lifecycle.
					</span>
				</motion.h2>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="grid grid-cols-1 border-[#202329] md:grid-cols-3 md:border-x"
				>
					<LinearBentoCard fig="FIG 1.1" title="Publish tasks immediately" copy="POST a URL and payload to create a queued task that is dispatched through the worker queue.">
						<MiniDashboardVisual />
					</LinearBentoCard>
					<LinearBentoCard fig="FIG 1.2" title="Send JSON to webhooks" copy="Runmesh executes tasks as HTTP POST requests with your payload and records the final outcome.">
						<TriageVisual />
					</LinearBentoCard>
					<LinearBentoCard fig="FIG 1.3" title="Track execution states" copy="Follow work as it moves through queued, running, completed, failed, or cancelled.">
						<AgentsVisual />
					</LinearBentoCard>
				</motion.div>
			</div>
		</section>
	)
}
