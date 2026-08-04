import { motion } from "framer-motion"
import { sectionPadding } from "./constants"

const steps = [
	{
		title: "Install the CLI",
		cmd: "go install github.com/Daviduche03/Runmesh/runmesh-main/workspace/cmd/runmesh@latest",
		desc: "Requires Go 1.25+. The runmesh binary installs to your GOPATH — put it on your PATH and you're ready.",
	},
	{
		title: "Configure credentials (once)",
		cmd: "runmesh config set --bucket my-bucket --endpoint https://<account>.r2.cloudflarestorage.com --access-key <key> --secret-key <secret>",
		desc: "Saved globally to ~/.runmesh/config.json (0600). Works with Cloudflare R2, AWS S3, Minio, Wasabi, or any S3-compatible provider.",
	},
	{
		title: "Log in (optional)",
		cmd: "runmesh login   # device-code auth\nrunmesh whoami   # check your session",
		desc: "Optional — links your CLI to your Runmesh account so linked projects register with it. Everything else works without logging in.",
	},
	{
		title: "Link your project",
		cmd: "cd ~/code/my-project && runmesh link my-project",
		desc: "Creates .runmesh/config.json and a sensible default .devignore. Your directory is now mapped to bucket/my-project/ in the cloud.",
	},
	{
		title: "Sync",
		cmd: "runmesh up      # Push local changes to cloud\nrunmesh down    # Pull cloud changes to local\nrunmesh watch   # Auto-sync daemon (push on change, pull every 8s)",
		desc: "Run one-time syncs with up/down, or leave watch running for continuous two-way sync between devices.",
	},
	{
		title: "Inspect",
		cmd: "runmesh list     # List files in cloud\nrunmesh status   # Show local vs remote diff",
		desc: "Confirm what is synced and catch drift before it reaches another machine.",
	},
	{
		title: "Encrypt your .env (recommended)",
		cmd: "runmesh envkey --generate        # On your primary device\nrunmesh envkey --show              # Print the hex key\nrunmesh config set --env-key <hex> # On your other devices",
		desc: ".env files sync encrypted with AES-256-GCM — plaintext never leaves your devices, and the key never touches the cloud.",
	},
]

export function CliSection() {
	return (
		<section id="cli" className={`scroll-mt-14 border-b border-[#15181d] ${sectionPadding}`}>
			<div className="mx-auto w-[min(1256px,calc(100%_-_48px))]">
				<motion.h2
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1] }}
					className="mb-16 max-w-[940px] ml-auto text-right text-balance text-[clamp(40px,4.2vw,52px)] font-[590] leading-[1.08] tracking-[-0.045em] text-white"
				>
					Setup in seven commands.{" "}
					<span className="text-[#8f949e]">
						The runmesh CLI connects local development, cloud workspaces, and agent execution around the same project files.
					</span>
				</motion.h2>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="grid grid-cols-1 border-[#202329] md:grid-cols-2 xl:grid-cols-4 md:border-x"
				>
					{steps.map((s, i) => (
						<article key={s.title} className="group flex min-h-[320px] flex-col border-[#202329] md:border-r md:last:border-r-0 xl:border-b xl:last:border-b-0">
					<div className="flex items-center justify-between px-8 pt-8">
						<span className="font-mono text-[12px] tracking-[0.16em] text-[#383c44]">STEP {i + 1}</span>
						<span className="font-mono text-[12px] text-[#383c44]">0{i + 1}</span>
					</div>
							<div className="px-8 pt-6">
								<h3 className="text-[16px] font-[590] tracking-[-0.01em] text-[#d8dce3]">{s.title}</h3>
								<pre className="mt-4 overflow-x-auto rounded-md bg-[#0d0e10] p-3 text-[12px] leading-5 text-[#c9cdd4]">
									<code>{s.cmd}</code>
								</pre>
							</div>
							<p className="px-8 pb-8 pt-4 text-[14px] leading-6 text-[#8f949e]">{s.desc}</p>
						</article>
					))}
				</motion.div>
			</div>
		</section>
	)
}
