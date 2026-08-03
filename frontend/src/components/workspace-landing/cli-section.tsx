import { motion } from "framer-motion"
import { Badge } from "./badge"
import { container, sectionPadding } from "./constants"
import { Download, KeyRound, Link2, RefreshCw, Eye, Lock, User } from "lucide-react"

const steps = [
	{
		icon: Download,
		title: "Install the CLI",
		cmd: "go install github.com/Daviduche03/Runmesh/runmesh-main/workspace/cmd/runmesh@latest",
		desc: "Requires Go 1.25+. The runmesh binary installs to your GOPATH — put it on your PATH and you're ready.",
	},
	{
		icon: KeyRound,
		title: "Configure credentials (once)",
		cmd: "runmesh config set --bucket my-bucket --endpoint https://<account>.r2.cloudflarestorage.com --access-key <key> --secret-key <secret>",
		desc: "Saved globally to ~/.runmesh/config.json (0600). Works with Cloudflare R2, AWS S3, Minio, Wasabi, or any S3-compatible provider.",
	},
	{
		icon: User,
		title: "Log in (optional)",
		cmd: "runmesh login   # device-code auth\nrunmesh whoami   # check your session",
		desc: "Optional — links your CLI to your Runmesh account so linked projects register with it. Everything else works without logging in.",
	},
	{
		icon: Link2,
		title: "Link your project",
		cmd: "cd ~/code/my-project && runmesh link my-project",
		desc: "Creates .runmesh/config.json and a sensible default .devignore. Your directory is now mapped to bucket/my-project/ in the cloud.",
	},
	{
		icon: RefreshCw,
		title: "Sync",
		cmd: "runmesh up      # Push local changes to cloud\nrunmesh down    # Pull cloud changes to local\nrunmesh watch   # Auto-sync daemon (push on change, pull every 8s)",
		desc: "Run one-time syncs with up/down, or leave watch running for continuous two-way sync between devices.",
	},
	{
		icon: Eye,
		title: "Inspect",
		cmd: "runmesh list     # List files in cloud\nrunmesh status   # Show local vs remote diff",
		desc: "Confirm what is synced and catch drift before it reaches another machine.",
	},
	{
		icon: Lock,
		title: "Encrypt your .env (recommended)",
		cmd: "runmesh envkey --generate        # On your primary device\nrunmesh envkey --show              # Print the hex key\nrunmesh config set --env-key <hex> # On your other devices",
		desc: ".env files sync encrypted with AES-256-GCM — plaintext never leaves your devices, and the key never touches the cloud.",
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
					<Badge>Get started</Badge>
					<h2 className="max-w-[640px] text-balance text-[clamp(34px,4vw,56px)] font-[590] leading-[1.04] tracking-[-0.05em] text-white">
						Setup in seven commands
					</h2>
					<p className="mt-4 max-w-[560px] text-[17px] leading-7 tracking-[-0.015em] text-[#8f949e]">
						The <code className="rounded bg-[#161616] px-1.5 py-0.5 text-[15px] text-[#d8dce3]">runmesh</code> CLI connects local development,
						cloud workspaces, and agent execution around the same project files. Here's the whole flow.
					</p>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="mt-16 grid gap-px overflow-hidden rounded-lg border border-[#202329] bg-[#202329] sm:grid-cols-2"
				>
					{steps.map((s, i) => (
						<div key={s.title} className="flex flex-col gap-3 bg-[#08090a] p-8">
							<div className="flex items-center gap-3">
								<div className="grid size-10 place-items-center rounded-lg border border-[#24272d] bg-[#101113]">
									<s.icon className="size-5 text-[#8f949e]" />
								</div>
								<span className="font-mono text-xs text-[#4c5158]">0{i + 1}</span>
							</div>
							<h3 className="text-[16px] font-[590] tracking-[-0.01em] text-[#d8dce3]">{s.title}</h3>
							<pre className="overflow-x-auto rounded-md bg-[#0d0e10] p-3 text-[13px] leading-5 text-[#c9cdd4]">
								<code>{s.cmd}</code>
							</pre>
							<p className="text-[15px] leading-6 text-[#8f949e]">{s.desc}</p>
						</div>
					))}
				</motion.div>
			</div>
		</section>
	)
}
