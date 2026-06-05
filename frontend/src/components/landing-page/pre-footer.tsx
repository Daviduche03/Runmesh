import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { narrowContainer } from "./constants"
import { motion } from "framer-motion"

export function PreFooter() {
	return (
		<section id="contact" className="scroll-mt-14 py-16 text-center">
			<div className={narrowContainer}>
				<motion.h2
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1] }}
					className="mx-auto max-w-[760px] text-balance text-[clamp(32px,5vw,56px)] font-[590] leading-[1.02] tracking-[-0.055em] text-white"
				>
					Queue and schedule webhook tasks with Runmesh
				</motion.h2>
				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
				>
					<Button asChild className="mt-6 h-8 bg-[#f2f2f2] text-sm font-medium text-[#08090a] hover:bg-white">
						<Link to="/signup">Start building</Link>
					</Button>
				</motion.div>
			</div>
		</section>
	)
}
