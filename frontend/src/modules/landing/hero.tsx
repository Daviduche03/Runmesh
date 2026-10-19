import { Link } from "react-router-dom"
import { ArrowRight } from "@phosphor-icons/react"
import { container } from "./constants"
import { BrowserFrame, DotField } from "./primitives"

export function Hero() {
	return (
		<section className="relative overflow-hidden pt-20 pb-16 lg:pt-28 lg:pb-24">
			<div className="relative">
				<div className={container}>
					<div className="max-w-[1000px]">
						<div className="flex items-center gap-3">
							<DotField
								cols={4}
								rows={2}
								size={5}
								gap={3}
								lit={[0, 3, 4, 7]}
								className="shrink-0"
							/>
							<span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--rm-faint)]">
								The control plane for AI agents
							</span>
						</div>

						<h1 className="mt-7 text-balance font-display-sans text-[clamp(36px,4.4vw,56px)] font-medium leading-[1.08] tracking-[-0.025em] text-[var(--rm-fg)]">
							Consent, policy, and a receipt{" "}
							<span className="text-[var(--rm-accent)]">for everything your agents do.</span>
						</h1>

						<p className="mt-7 max-w-[600px] text-pretty text-[18px] leading-7 tracking-[-0.01em] text-[var(--rm-muted)]">
							Runmesh sits between an agent&rsquo;s intent and a real action. It decides whether the action
							is allowed, executes it durably, and records it — so you can see what they did, decide what
							they can do, and stop them when they shouldn&rsquo;t.
						</p>

						<div className="mt-9 flex flex-wrap items-center gap-3">
							<Link
								to="/signup"
								className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-[var(--rm-btn-bg)] px-5 text-[15px] font-medium text-[var(--rm-btn-fg)] no-underline transition-[opacity,transform] duration-150 ease-[var(--ease-out)] hover:opacity-90 active:scale-[0.98]"
							>
								Get started free
								<ArrowRight className="size-4" weight="bold" />
							</Link>
							<a
								href="https://github.com/Daviduche03/Runmesh"
								target="_blank"
								rel="noreferrer"
								className="inline-flex h-11 items-center rounded-[8px] border border-[var(--rm-line-strong)] bg-white px-5 text-[15px] font-medium text-[var(--rm-fg)] no-underline transition-[border-color,transform] duration-150 ease-[var(--ease-out)] hover:border-[var(--rm-faint)] active:scale-[0.98]"
							>
								Read the source
							</a>
						</div>

						<p className="mt-6 text-[13.5px] text-[var(--rm-faint)]">
							MIT licensed. Runs on your own infrastructure. Nothing to install in the agent.
						</p>
					</div>
				</div>

				<div className={`${container} mt-16 lg:mt-20`}>
					<BrowserFrame
						src="/shots/control-room.webp"
						alt="The Runmesh control room: pending consent, active agents, action throughput, action outcomes, and a live audit feed."
						url="app.runmesh.dev/control-room"
						className="w-full"
					/>
				</div>
			</div>
		</section>
	)
}
