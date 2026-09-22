import { Link } from "react-router-dom"
import { container } from "./constants"
import { SectionLabel } from "./section-label"
import { HeroVisual } from "./hero-visual"

const facts = [
	{ k: "identity", v: "agents · tasks · workflow runs" },
	{ k: "access", v: "scoped · revocable · time-limited" },
	{ k: "control", v: "approvals · policy · audit" },
]

export function Hero() {
	return (
		<section className="relative border-b border-[var(--rm-line)] pt-32 pb-16 lg:pt-40 lg:pb-20">
			<div className={container}>
				<div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:items-end">
					<div>
						<SectionLabel index="00">Identity · Access · Control</SectionLabel>
						<h1 className="mt-6 max-w-[760px] text-balance font-display text-[clamp(38px,5vw,64px)] font-medium leading-[1.02] tracking-[-0.03em] text-[var(--rm-fg)]">
							The control plane for AI agents
						</h1>
						<p className="mt-6 max-w-[580px] text-[17px] leading-7 tracking-[-0.01em] text-[var(--rm-muted)]">
							Every agent gets an identity and a scoped, revocable, auditable credential — tied to the task that
							requested it. See what they did, decide what they can do, and stop them when they shouldn't.
						</p>
						<div className="mt-8 flex items-center gap-3">
							<Link
								to="/signup"
								className="inline-flex h-9 items-center rounded-[4px] bg-[var(--rm-btn-bg)] px-4 text-[13px] font-medium text-[var(--rm-btn-fg)] no-underline transition-[opacity,transform] duration-150 ease-[var(--ease-out)] hover:opacity-90 active:scale-[0.96]"
							>
								Start building
							</Link>
							<Link
								to="/login"
								className="inline-flex h-9 items-center rounded-[4px] border border-[var(--rm-line-strong)] px-4 text-[13px] font-medium text-[var(--rm-fg-2)] no-underline transition-[color,transform] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-fg)] active:scale-[0.96]"
							>
								View the API
							</Link>
						</div>
					</div>

					<dl className="grid gap-y-4 border-t border-[var(--rm-line)] pt-6 lg:border-t-0 lg:pt-0">
						{facts.map((fact) => (
							<div className="flex flex-col gap-1" key={fact.k}>
								<dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--rm-faint)]">
									{fact.k}
								</dt>
								<dd className="font-mono text-[13px] text-[var(--rm-fg-2)]">{fact.v}</dd>
							</div>
						))}
					</dl>
				</div>

					<div className="mt-14 overflow-hidden border border-[var(--rm-line)] bg-[var(--rm-panel)] p-4 lg:mt-16">
						<HeroVisual />
					</div>
			</div>
		</section>
	)
}
