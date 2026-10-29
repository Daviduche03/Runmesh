import { container } from "./constants"
import { SelfHostScene } from "./self-host-art"

const points = [
	{
		title: "One process, one file",
		copy: "A single server with a single database file. No control-plane service to buy, no external database, no sidecar to operate.",
	},
	{
		title: "Any host",
		copy: "A VM, a container, your own cluster. It ships as a Dockerfile and a compose file, and nothing about the runtime is proprietary.",
	},
	{
		title: "Your data stays yours",
		copy: "Grants, decisions and receipts live in your database. Export them whenever you like. There is no telemetry and no third-party processing.",
	},
]

export function SelfHost() {
	return (
		<section
			id="self-host"
			className="scroll-mt-16 border-t border-[var(--rm-line)] py-20 lg:py-28"
		>
			<div className={container}>
				<div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-16">
					<div>
						<h2 className="text-balance font-display-sans text-[clamp(28px,3.8vw,46px)] font-medium leading-[1.08] tracking-[-0.03em] text-[var(--rm-fg)]">
							Run it where your agents already run
						</h2>
						<p className="mt-5 max-w-[480px] text-pretty text-[16px] leading-7 text-[var(--rm-muted)]">
							Deliberately boring to deploy. If you can run a container, you can run
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

					<SelfHostScene />
				</div>
			</div>
		</section>
	)
}
