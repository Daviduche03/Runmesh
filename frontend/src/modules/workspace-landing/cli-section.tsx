import { container } from "./constants"
import { SectionHeading } from "@/modules/landing/section-heading"

const steps = [
	[
		"Install the CLI",
		"go install github.com/Daviduche03/Runmesh/runmesh-main/workspace/cmd/runmesh@latest",
		"Requires Go 1.25+. The binary installs to your GOPATH — put it on your PATH.",
	],
	[
		"Configure credentials",
		"runmesh config set --bucket my-bucket --endpoint <url> --access-key <key> --secret-key <secret>",
		"Saved to ~/.runmesh/config.json (0600). Works with R2, S3, Minio, Wasabi.",
	],
	["Log in (optional)", "runmesh login", "Links the CLI to your account. Everything else works without it."],
	[
		"Link your project",
		"cd ~/code/my-project && runmesh link my-project",
		"Creates .runmesh/config.json and a sensible default .devignore.",
	],
	["Sync", "runmesh up   ·   runmesh down   ·   runmesh watch", "One-time syncs or a continuous two-way daemon."],
	["Inspect", "runmesh list   ·   runmesh status", "Confirm what is synced and catch drift early."],
	["Encrypt your .env", "runmesh envkey --generate", "Recommended. AES-256-GCM before anything is uploaded."],
]

export function CliSection() {
	return (
		<section id="cli" className="scroll-mt-14 border-b border-[var(--rm-line)] py-24 lg:py-32">
			<div className={container}>
				<SectionHeading index="04" label="CLI" title="Setup in seven commands">
					The runmesh CLI connects local development, cloud workspaces, and agent execution around the same project
					files. Here is the whole flow.
				</SectionHeading>

				<ol className="mt-14 divide-y divide-[var(--rm-line)] border-y border-[var(--rm-line)]">
					{steps.map(([title, cmd, desc], index) => (
						<li className="grid gap-4 py-6 lg:grid-cols-[36px_minmax(0,260px)_minmax(0,1fr)] lg:gap-8" key={title}>
							<span className="font-mono text-[12px] text-[var(--rm-faint)]">0{index + 1}</span>
							<div>
								<h3 className="font-display text-[16px] font-medium tracking-[-0.01em] text-[var(--rm-fg)]">
									{title}
								</h3>
								<code className="mt-2 block break-all font-mono text-[12.5px] leading-5 text-[var(--rm-accent)]">
									{cmd}
								</code>
							</div>
							<p className="text-[14px] leading-6 text-[var(--rm-muted)]">{desc}</p>
						</li>
					))}
				</ol>
			</div>
		</section>
	)
}
