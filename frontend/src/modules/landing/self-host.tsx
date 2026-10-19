import { container } from "./constants"
import { BrowserFrame, Eyebrow } from "./primitives"

const points = [
	{
		title: "One process, one file",
		copy: "A plain Python server on FastAPI with a SQLite file for storage. No control plane service, no external database, no sidecar to operate.",
	},
	{
		title: "Any host",
		copy: "A VM, a container, your own Kubernetes cluster. It ships as a Dockerfile and a compose file. Nothing about the runtime is proprietary.",
	},
	{
		title: "Your data stays yours",
		copy: "Grants, audit events, and policy decisions live in your database. Export them at any time. There is no telemetry and no third-party processing.",
	},
]

export function SelfHost() {
	return (
		<section className="border-t border-[var(--rm-line)] bg-[var(--rm-panel)] py-20 lg:py-28">
			<div className={container}>
				<div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-16">
					<div>
						<Eyebrow>Open source</Eyebrow>
						<h2 className="mt-5 text-balance font-display text-[clamp(28px,3.8vw,46px)] font-medium leading-[1.08] tracking-[-0.03em] text-[var(--rm-fg)]">
							Run it where your agents already run
						</h2>
						<p className="mt-5 max-w-[480px] text-pretty text-[16px] leading-7 text-[var(--rm-muted)]">
							MIT licensed, and deliberately boring to deploy. If you can run a Python process, you can run
							Runmesh.
						</p>

						<dl className="mt-10 grid gap-8">
							{points.map((point) => (
								<div key={point.title}>
									<dt className="text-[16px] font-medium tracking-[-0.01em] text-[var(--rm-fg)]">
										{point.title}
									</dt>
									<dd className="mt-1.5 max-w-[440px] text-[15px] leading-6 text-[var(--rm-muted)]">
										{point.copy}
									</dd>
								</div>
							))}
						</dl>
					</div>

					<div className="grid gap-4">
						<BrowserFrame
							src="/shots/agents.webp"
							alt="The Runmesh agents directory: six registered agents with their ids, status, and grant counts, including one suspended agent."
							url="app.runmesh.dev/agents"
							className="w-full"
						/>
						<BrowserFrame
							src="/shots/connect.webp"
							alt="The Runmesh connect page: available providers, connected users, the scopes each one granted, and when they connected."
							url="app.runmesh.dev/connect"
							className="w-full"
						/>
					</div>
				</div>
			</div>
		</section>
	)
}
