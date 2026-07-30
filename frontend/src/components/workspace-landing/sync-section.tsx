import { motion } from "framer-motion"
import { Badge } from "./badge"
import { container, sectionPadding } from "./constants"
import { ArrowUpFromLine, ArrowDownFromLine, Eye, RefreshCw } from "lucide-react"

const features = [
	{
		icon: ArrowUpFromLine,
		title: "Push to cloud",
		desc: "One-command upload: runmesh workspace up copies project context to S3/R2, respecting .devignore patterns.",
	},
	{
		icon: ArrowDownFromLine,
		title: "Pull from cloud",
		desc: "runmesh workspace down fetches the latest cloud state to any machine or execution environment.",
	},
	{
		icon: Eye,
		title: "List & status",
		desc: "runmesh workspace list shows remote files; runmesh workspace status diffs local vs cloud file sets.",
	},
	{
		icon: RefreshCw,
		title: "Auto-sync daemon",
		desc: "runmesh workspace watch keeps local and cloud context aligned while developers and agents move between machines.",
	},
]

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
					<Badge>Sync</Badge>
					<h2 className="max-w-[640px] text-balance text-[clamp(34px,4vw,56px)] font-[590] leading-[1.04] tracking-[-0.05em] text-white">
						Keep project context ready for every actor
					</h2>
					<p className="mt-4 max-w-[560px] text-[17px] leading-7 tracking-[-0.015em] text-[#8f949e]">
						Your project files live in an S3-compatible bucket: Cloudflare R2, AWS S3, Minio, or any provider.
						<span className="text-white"> Developers and agents can pick up the same workspace without forcing every handoff through git.</span>
					</p>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="mt-16 grid gap-px overflow-hidden rounded-lg border border-[#202329] bg-[#202329] sm:grid-cols-2"
				>
					{features.map((f) => (
						<div key={f.title} className="flex flex-col gap-3 bg-[#08090a] p-8">
							<div className="grid size-10 place-items-center rounded-lg border border-[#24272d] bg-[#101113]">
								<f.icon className="size-5 text-[#8f949e]" />
							</div>
							<h3 className="text-[16px] font-[590] tracking-[-0.01em] text-[#d8dce3]">{f.title}</h3>
							<p className="text-[15px] leading-6 text-[#8f949e]">{f.desc}</p>
						</div>
					))}
				</motion.div>
			</div>
		</section>
	)
}
