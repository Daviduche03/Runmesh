import { motion } from "framer-motion"
import { SectionIntro } from "./section-intro"
import { container, sectionPadding } from "./constants"

const steps = [
	{
		cmd: "runmesh envkey --generate",
		out: "Generated new .env encryption key (fingerprint 1a2b3c4d)",
		note: "One time on your primary device. Saves the key to ~/.runmesh/config.json (0600).",
	},
	{
		cmd: "runmesh envkey --show",
		out: "Key (keep secret): <hex>",
		note: "Prints the key so you can copy it to your other machines.",
	},
	{
		cmd: "runmesh config set --env-key <hex>",
		out: "Env encryption key saved to ~/.runmesh/config.json",
		note: "On each additional device, restore the same key and syncs decrypt locally.",
	},
]

export function EncryptSection() {
	return (
		<section id="env" className={`scroll-mt-14 border-b border-[#15181d] ${sectionPadding}`}>
			<div className={container}>
				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1] }}
				>
					<SectionIntro badge="Encrypted .env" title="Secrets sync without ever leaving plaintext">
						<span className="text-white">Your .env files travel encrypted with AES-256-GCM.</span> The key is generated on your
						device, never uploaded, and shared only between machines you control.
					</SectionIntro>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="overflow-hidden rounded-lg border border-[#24272d] bg-[#0d0e10]"
				>
					<div className="flex items-center gap-2 border-b border-[#24272d] px-4 py-2.5">
						<span className="size-2.5 rounded-full bg-[#ff5f56]" />
						<span className="size-2.5 rounded-full bg-[#ffbd2e]" />
						<span className="size-2.5 rounded-full bg-[#27c93f]" />
						<span className="ml-2 text-[12px] text-[#595a5c]">setup</span>
					</div>
					<div className="grid gap-0 lg:grid-cols-3">
						{steps.map((step, index) => (
							<div
								className="flex flex-col border-b border-[#24272d] p-6 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"
								key={step.cmd}
							>
								<div className="flex items-center justify-between">
									<span className="font-mono text-[12px] tracking-[0.16em] text-[#383c44]">STEP {index + 1}</span>
									<span className="font-mono text-[12px] text-[#383c44]">0{index + 1}</span>
								</div>
								<div className="mt-6 rounded-[6px] border border-[#24272d] bg-[#08090a] p-4 font-mono text-[13px] leading-6">
									<div className="text-[#6f7cff]">{step.cmd}</div>
									<div className="mt-2 text-[#4c525c]">{step.out}</div>
								</div>
								<p className="mt-4 text-[14px] leading-6 text-[#8f949e]">{step.note}</p>
							</div>
						))}
					</div>
				</motion.div>
			</div>
		</section>
	)
}
