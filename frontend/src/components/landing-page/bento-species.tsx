import { PurposeVisual } from "./visuals/purpose-visual"
import { AgentsVisual } from "./visuals/agents-visual"
import { SpeedVisual } from "./visuals/speed-visual"
import { motion } from "framer-motion"

const bentoCards = [
	{
		fig: "FIG 0.2",
		title: "Built for HTTP tasks",
		copy: "Send Runmesh a URL and JSON payload. It creates a durable task and handles execution for you.",
		visual: <PurposeVisual />,
		delay: 0,
	},
	{
		fig: "FIG 0.3",
		title: "Queue now or later",
		copy: "Publish tasks immediately or schedule them for a precise future UTC timestamp.",
		visual: <AgentsVisual />,
		delay: 0.15,
	},
	{
		fig: "FIG 0.4",
		title: "Webhook execution",
		copy: "The worker POSTs your payload to the target endpoint and records the result.",
		visual: <SpeedVisual />,
		delay: 0.3,
	},
]

export function BentoSpecies() {
	return (
		<section id="features" className="scroll-mt-14 border-b border-[#15181d] py-16">
			<div className="mx-auto w-[min(1256px,calc(100%_-_48px))]">
				<motion.h2
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1] }}
					className="max-w-[940px] text-balance text-[clamp(40px,4.2vw,52px)] font-[590] leading-[1.08] tracking-[-0.045em] text-white"
				>
					Three primitives that cover the task lifecycle.{" "}
					<span className="text-[#8f949e]">
						Runmesh handles scheduling, dispatch, and result recording so you can focus on what
						matters.
					</span>
				</motion.h2>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="mt-32 grid grid-cols-1 border-[#202329] md:grid-cols-3 md:border-x"
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
