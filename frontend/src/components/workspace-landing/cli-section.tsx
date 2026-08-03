import { motion } from "framer-motion"
import { Badge } from "./badge"
import { container, sectionPadding } from "./constants"
import { Terminal, Download, Key, BookOpen } from "lucide-react"

const steps = [
	{
		icon: Download,
		title: "Install the CLI",
		desc: "go install github.com/Daviduche03/Runmesh/runmesh-main/workspace/cmd/runmesh@latest",
	},
	{
		icon: Key,
		title: "Configure credentials",
		desc: "runmesh config set --bucket my-bucket --endpoint https://... --access-key ... --secret-key ...",
	},
	{
		icon: Terminal,
		title: "Link your project",
		desc: "cd ~/code/my-project && runmesh link my-project",
	},
	{
		icon: BookOpen,
		title: "Sync or mount",
		desc: "runmesh watch\nrunmesh mount ~/code",
	},
]

export function CliSection() {
	return (
		<section id="cli" className={`scroll-mt-14 border-b border-[#15181d] ${sectionPadding}`}>
			<div className={container}>
				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1] }}
				>
					<Badge>CLI</Badge>
					<h2 className="max-w-[640px] text-balance text-[clamp(34px,4vw,56px)] font-[590] leading-[1.04] tracking-[-0.05em] text-white">
						One command surface for portable project context
					</h2>
					<p className="mt-4 max-w-[560px] text-[17px] leading-7 tracking-[-0.015em] text-[#8f949e]">
						The <code className="rounded bg-[#161616] px-1.5 py-0.5 text-[15px] text-[#d8dce3]">runmesh</code> CLI connects local development,
						cloud workspaces, and agent execution around the same project files.
					</p>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="mt-16 grid gap-px overflow-hidden rounded-lg border border-[#202329] bg-[#202329] sm:grid-cols-2"
				>
					{steps.map((s) => (
						<div key={s.title} className="flex flex-col gap-3 bg-[#08090a] p-8">
							<div className="grid size-10 place-items-center rounded-lg border border-[#24272d] bg-[#101113]">
								<s.icon className="size-5 text-[#8f949e]" />
							</div>
							<h3 className="text-[16px] font-[590] tracking-[-0.01em] text-[#d8dce3]">{s.title}</h3>
							<pre className="overflow-x-auto rounded-md bg-[#0d0e10] p-3 text-[13px] leading-5 text-[#c9cdd4]">
								<code>{s.desc}</code>
							</pre>
						</div>
					))}
				</motion.div>
			</div>
		</section>
	)
}
