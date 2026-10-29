import { Link } from "react-router-dom"
import { ArrowRight } from "@phosphor-icons/react"
import { container } from "./constants"

export function Hero() {
	return (
		<section className="relative overflow-hidden pt-20 pb-16 lg:pt-28 lg:pb-24">
			<div className="relative">
				<div className={container}>
					<div className="max-w-[1000px]">
						<h1 className="text-balance font-display-sans text-[clamp(36px,4.4vw,56px)] font-medium leading-[1.08] tracking-[-0.025em] text-[var(--rm-fg)]">
							Consent, policy, and a receipt{" "}
							<span className="text-[var(--rm-accent)]">for everything your agents do.</span>
						</h1>

						<p className="mt-6 max-w-[520px] text-pretty text-[16px] leading-6 text-[var(--rm-muted)]">
							Runmesh sits between an agent&rsquo;s intent and a real action. It decides what is
							allowed, executes durably, and records the result.
						</p>

						<div className="mt-8 flex flex-wrap items-center gap-3">
							<Link
								to="/signup"
								className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[var(--rm-btn-bg)] px-4 text-[14px] font-medium text-[var(--rm-btn-fg)] no-underline transition-[opacity,transform] duration-150 ease-[var(--ease-out)] hover:opacity-90 active:scale-[0.98]"
							>
								Get started free
								<ArrowRight className="size-3.5" weight="bold" />
							</Link>
							<Link
								to="/#how-it-works"
								className="inline-flex h-10 items-center rounded-[8px] border border-[var(--rm-line-strong)] bg-white px-4 text-[14px] font-medium text-[var(--rm-fg)] no-underline transition-[border-color,transform] duration-150 ease-[var(--ease-out)] hover:border-[var(--rm-faint)] active:scale-[0.98]"
							>
								See how it works
							</Link>
						</div>
					</div>
				</div>

				<div className={`${container} mt-16 lg:mt-20`}>
					<div className="relative overflow-hidden rounded-2xl bg-[#f3ece2] p-[18px] ring-1 ring-black/5 sm:p-[26px] lg:p-[35px]">
						<img
							src="/hero-backdrop.webp"
							alt=""
							aria-hidden="true"
							className="absolute inset-0 size-full object-cover"
						/>
						<img
							src="/shots/control-room.webp"
							alt="The Runmesh control room: pending consent, active agents, action throughput, action outcomes, and a live audit feed."
							className="relative block w-full rounded-[10px] shadow-[0_28px_60px_-28px_rgba(62,42,24,0.45)] ring-1 ring-black/10"
						/>
					</div>
				</div>
			</div>
		</section>
	)
}
