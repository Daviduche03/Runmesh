import { Link } from "react-router-dom"
import { ArrowRight } from "@phosphor-icons/react"
import { container } from "./constants"

export function PreFooter() {
	return (
		<section className="border-t border-[var(--rm-ink-line)] bg-[var(--rm-ink)] py-20 lg:py-28">
			<div className={container}>
				<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
					<div>
						<h2 className="max-w-[820px] text-balance font-display-sans text-[clamp(34px,5vw,64px)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--rm-ink-fg)]">
							Give your agents access you can prove and revoke
						</h2>
						<p className="mt-5 max-w-[520px] text-pretty text-[17px] leading-7 text-[var(--rm-ink-muted)]">
							Start with one agent and one provider. No migration, no sidecar, no new runtime.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<Link
							to="/signup"
							className="inline-flex h-11 items-center gap-2 rounded-[8px] bg-[var(--rm-ink-fg)] px-5 text-[15px] font-medium text-[var(--rm-ink)] no-underline transition-[opacity,transform] duration-150 ease-[var(--ease-out)] hover:opacity-90 active:scale-[0.98]"
						>
							Get started free
							<ArrowRight className="size-4" weight="bold" />
						</Link>
						<Link
							to="/login"
							className="inline-flex h-11 items-center rounded-[8px] border border-[var(--rm-ink-line)] px-5 text-[15px] font-medium text-[var(--rm-ink-fg)] no-underline transition-[border-color] duration-150 ease-[var(--ease-out)] hover:border-[var(--rm-ink-muted)]"
						>
							Log in
						</Link>
					</div>
				</div>
			</div>
		</section>
	)
}
