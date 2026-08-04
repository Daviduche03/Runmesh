import { motion } from "framer-motion"
import { SectionIntro } from "./section-intro"
import { container, sectionPadding } from "./constants"
import { FuseVisual } from "./visuals/fuse-visual"

export function FusefsSection() {
	return (
		<section id="fuse" className={`scroll-mt-14 border-b border-[#15181d] ${sectionPadding}`}>
			<div className={container}>
				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1] }}
				>
					<SectionIntro badge="FUSE" title="Mount the same workspace anywhere work runs">
						<span className="text-white">The cloud bucket becomes a FUSE filesystem that behaves like a local drive.</span>{" "}
						Same mount on any macOS or Linux machine — the bridge from laptop to cloud workspace to agent sandbox.
					</SectionIntro>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="grid gap-px overflow-hidden rounded-lg border border-[#202329] bg-[#202329] sm:grid-cols-2"
				>
					<div className="flex flex-col gap-3 bg-[#08090a] p-8">
						<FuseVisual />
						<h3 className="text-[16px] font-[590] tracking-[-0.01em] text-[#d8dce3]">Mount as local filesystem</h3>
						<p className="text-[15px] leading-6 text-[#8f949e]">
							runmesh mount exposes your workspace as a FUSE filesystem with files available on demand.
						</p>
					</div>
					<div className="flex flex-col gap-3 bg-[#08090a] p-8">
						<div className="grid size-10 place-items-center rounded-lg border border-[#24272d] bg-[#101113]">
							<span className="size-5 rounded-full bg-[#4cb782]" />
						</div>
						<h3 className="text-[16px] font-[590] tracking-[-0.01em] text-[#d8dce3]">Write-back caching</h3>
						<p className="text-[15px] leading-6 text-[#8f949e]">
							Edits are buffered locally and uploaded asynchronously on file close. Network glitches never lose your work.
						</p>
						<div className="mt-4 flex flex-col gap-3 border-t border-[#24272d] pt-4">
							<div className="flex items-start gap-3">
								<span className="size-1.5 rounded-full bg-[#6f7cff]" />
								<p className="text-[14px] leading-6 text-[#8f949e]">Lazy download — files fetched from cloud only when opened.</p>
							</div>
							<div className="flex items-start gap-3">
								<span className="size-1.5 rounded-full bg-[#6f7cff]" />
								<p className="text-[14px] leading-6 text-[#8f949e]">go-fuse v2 + macFUSE — native macOS and Linux mounts.</p>
							</div>
						</div>
					</div>
				</motion.div>
			</div>
		</section>
	)
}
