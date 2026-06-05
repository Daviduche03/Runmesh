import { SectionIntro } from "./section-intro"
import { TaskApiPreview } from "./task-api-preview"
import { container } from "./constants"
import { motion } from "framer-motion"

export function CustomerSection() {
	return (
		<section id="task-api" className="scroll-mt-14 border-b border-[#15181d] pt-16 pb-6">
			<div className={container}>
				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1] }}
				>
					<SectionIntro badge="Task API" title="Create, schedule, and move webhook work">
						<span className="text-white">Built around one job: reliable HTTP execution.</span> Publish tasks for immediate queueing,
						schedule future calls, reschedule queued work, or cancel it before dispatch.
					</SectionIntro>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="overflow-hidden rounded-t-lg border border-b-0 border-[#24272d] bg-[#111315]"
				>
					<TaskApiPreview />
				</motion.div>
			</div>
		</section>
	)
}
