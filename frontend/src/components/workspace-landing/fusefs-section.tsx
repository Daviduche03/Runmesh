import { sectionPadding } from "./constants"
import { FuseVisual } from "./visuals/fuse-visual"
import { motion } from "framer-motion"

export function FusefsSection() {
	return (
		<section id="fuse" className={`scroll-mt-14 border-b border-[#15181d] ${sectionPadding}`}>
			<div className="mx-auto w-[min(1256px,calc(100%_-_48px))]">
				<motion.h2
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1] }}
					className="max-w-[940px] text-balance text-[clamp(40px,4.2vw,52px)] font-[590] leading-[1.08] tracking-[-0.045em] text-white"
				>
					Mount the same workspace anywhere work runs.{" "}
					<span className="text-[#8f949e]">
						The cloud bucket becomes a FUSE filesystem that behaves like a local drive on any macOS or Linux machine.
					</span>
				</motion.h2>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="mt-16 grid grid-cols-1 border-[#202329] md:grid-cols-[1.2fr_0.8fr] md:border-x"
				>
					<article className="group flex min-h-[470px] flex-col border-[#202329] px-8 md:border-r">
						<div className="font-mono text-[12px] tracking-[0.16em] text-[#383c44]">FIG 2.1</div>
						<div className="flex flex-1 items-center justify-center py-10 opacity-80 transition-opacity duration-300 group-hover:opacity-100">
							<FuseVisual />
						</div>
						<div className="pb-1">
							<h3 className="mb-3 text-[16px] font-[590] tracking-[-0.01em] text-[#d8dce3]">Mount as local filesystem</h3>
							<p className="max-w-[520px] text-[16px] leading-6 text-[#8f949e]">
								runmesh mount exposes your workspace as a FUSE filesystem with files available on demand — the bridge from
								laptop to cloud workspace to agent sandbox.
							</p>
						</div>
					</article>

					<article className="min-h-[470px] px-8">
						<div className="font-mono text-[12px] tracking-[0.16em] text-[#383c44]">FIG 2.2</div>
						<div className="mt-20 grid gap-0 border-y border-[#202329]">
							{[
								["Write-back caching", "Edits buffer locally and upload on file close"],
								["Lazy download", "Files fetched from cloud only when opened"],
								["go-fuse v2 + macFUSE", "Native macOS and Linux mounts"],
							].map(([title, copy]) => (
								<div className="border-b border-[#202329] py-5 last:border-b-0" key={title}>
									<span className="text-[16px] font-[590] tracking-[-0.01em] text-[#d8dce3]">{title}</span>
									<p className="mt-1 text-[14px] text-[#8f949e]">{copy}</p>
								</div>
							))}
						</div>
						<p className="mt-16 max-w-[330px] text-[16px] leading-6 text-[#8f949e]">
							Network glitches never lose your work, and large buckets stay usable with no full sync wait.
						</p>
					</article>
				</motion.div>
			</div>
		</section>
	)
}
