import { motion } from "framer-motion"
import { Badge } from "./badge"
import { container, sectionPadding } from "./constants"
import { Lock, KeyRound, ShieldCheck, FileKey } from "lucide-react"

const features = [
	{
		icon: Lock,
		title: "End-to-end encrypted .env",
		desc: ".env files are sealed with AES-256-GCM on your device before upload. The cloud only ever stores ciphertext.",
	},
	{
		icon: KeyRound,
		title: "One key, every machine",
		desc: "runmesh envkey --generate creates a key; runmesh envkey --show prints it; runmesh config set --env-key <hex> restores it on the next device.",
	},
	{
		icon: ShieldCheck,
		title: "Zero-knowledge change detection",
		desc: "A keyed tag lets devices tell whether a secret changed without decrypting — no plaintext-hash oracle for outsiders.",
	},
	{
		icon: FileKey,
		title: "Templates stay shared",
		desc: ".env.example and .env.sample are never encrypted, so structure stays visible while real secrets stay locked.",
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
					<Badge>Encrypted .env</Badge>
					<h2 className="max-w-[640px] text-balance text-[clamp(34px,4vw,56px)] font-[590] leading-[1.04] tracking-[-0.05em] text-white">
						Secrets sync without ever leaving plaintext
					</h2>
					<p className="mt-4 max-w-[560px] text-[17px] leading-7 tracking-[-0.015em] text-[#8f949e]">
						Project files sync in the open, but your <code className="rounded bg-[#161616] px-1.5 py-0.5 text-[15px] text-[#d8dce3]">.env</code> secrets travel encrypted.
						<span className="text-white"> The key is generated on your device, never uploaded, and shared only between machines you control.</span>
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
