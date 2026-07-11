import { motion } from "framer-motion"
import { Badge } from "./badge"
import { container, sectionPadding } from "./constants"
import { HardDrive, Zap, CloudOff, Layers } from "lucide-react"

const benefits = [
	{
		icon: HardDrive,
		title: "Mount as local filesystem",
		desc: "continuumm mount exposes your entire bucket as a FUSE filesystem — every file available on-demand, no sync required.",
	},
	{
		icon: Zap,
		title: "Write-back caching",
		desc: "Edits are buffered locally and uploaded asynchronously on file close. Network glitches never lose your work.",
	},
	{
		icon: CloudOff,
		title: "Lazy download",
		desc: "Files are fetched from S3 only when opened. Large buckets stay usable — no waiting for full sync.",
	},
	{
		icon: Layers,
		title: "Native macOS & Linux",
		desc: "Built on go-fuse v2 with macFUSE support. Works on any macOS or Linux machine with FUSE installed.",
	},
]

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
					<Badge>FUSE</Badge>
					<h2 className="max-w-[640px] text-balance text-[clamp(34px,4vw,56px)] font-[590] leading-[1.04] tracking-[-0.05em] text-white">
						Mount your bucket — files without friction
					</h2>
					<p className="mt-4 max-w-[560px] text-[17px] leading-7 tracking-[-0.015em] text-[#8f949e]">
						The FUSE filesystem makes cloud storage behave like a local drive.
						<span className="text-white"> No syncing, no waiting, no duplicates.</span>
					</p>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="mt-16 grid gap-px overflow-hidden rounded-lg border border-[#202329] bg-[#202329] sm:grid-cols-2"
				>
					{benefits.map((b) => (
						<div key={b.title} className="flex flex-col gap-3 bg-[#08090a] p-8">
							<div className="grid size-10 place-items-center rounded-lg border border-[#24272d] bg-[#101113]">
								<b.icon className="size-5 text-[#8f949e]" />
							</div>
							<h3 className="text-[16px] font-[590] tracking-[-0.01em] text-[#d8dce3]">{b.title}</h3>
							<p className="text-[15px] leading-6 text-[#8f949e]">{b.desc}</p>
						</div>
					))}
				</motion.div>
			</div>
		</section>
	)
}
