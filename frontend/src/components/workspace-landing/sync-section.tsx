import { motion } from "framer-motion"
import { SectionIntro } from "./section-intro"
import { container, sectionPadding } from "./constants"
import { SyncVisual } from "./visuals/sync-visual"

export function SyncSection() {
	return (
		<section id="sync" className={`scroll-mt-14 border-b border-[#15181d] ${sectionPadding}`}>
			<div className={container}>
				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1] }}
				>
					<SectionIntro badge="Sync" title="Project files in the cloud, local on every device">
						<span className="text-white">Your project lives in S3-compatible storage — Cloudflare R2, AWS S3, or Minio.</span>{" "}
						Developers and agents pick up the same workspace without forcing every handoff through git.
					</SectionIntro>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="overflow-hidden rounded-t-lg border border-b-0 border-[#24272d] bg-[#111315]"
				>
					<div className="grid min-h-[420px] grid-cols-1 bg-[#0b0c0e] text-[#8f949e] lg:grid-cols-[0.92fr_1.08fr]">
						<div className="border-b border-[#24272d] p-8 lg:border-b-0 lg:border-r">
							<div className="font-mono text-[12px] tracking-[0.16em] text-[#383c44]">SYNC TOPOLOGY</div>
							<div className="mt-8">
								<SyncVisual />
							</div>
						</div>
						<div className="p-8">
							<div className="font-mono text-[12px] tracking-[0.16em] text-[#383c44]">SYNC LIFECYCLE</div>
							<div className="mt-10 grid gap-0 border-y border-[#24272d]">
								{[
									["up", "rclone CopyDir pushes changed files to the cloud prefix"],
									["down", "Every 8s the same compare runs in reverse and pulls diffs"],
									["watch", "fsnotify pushes on change, debounced to a 500ms window"],
									["devignore", "Patterns applied as rclone filters in every sync direction"],
								].map(([state, copy], index) => (
									<div className="grid grid-cols-[120px_1fr] border-b border-[#24272d] py-5 last:border-b-0" key={state}>
										<div className="flex items-center gap-3">
											<span className={`size-1.5 rounded-full ${index < 2 ? "bg-[#6f7cff]" : index === 2 ? "bg-[#4cb782]" : "bg-[#4c525c]"}`} />
											<span className="font-mono text-[12px] text-[#d8dce3]">{state}</span>
										</div>
										<div className="text-[14px] text-[#8f949e]">{copy}</div>
									</div>
								))}
							</div>
						</div>
					</div>
				</motion.div>
			</div>
		</section>
	)
}
