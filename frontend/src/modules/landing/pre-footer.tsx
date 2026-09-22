import { Link } from "react-router-dom"
import { container } from "./constants"

export function PreFooter() {
	return (
		<section id="contact" className="scroll-mt-14 border-b border-[var(--rm-line)] py-24 lg:py-32">
			<div className={`${container} grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end`}>
				<div>
					<div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--rm-accent)]">[05] Get started</div>
					<h2 className="mt-5 max-w-[760px] text-balance font-display text-[clamp(30px,4vw,52px)] font-medium leading-[1.04] tracking-[-0.03em] text-[var(--rm-fg)]">
						Give your agents access you can prove and revoke
					</h2>
				</div>
				<div className="flex items-center gap-3">
					<Link
						to="/signup"
						className="inline-flex h-9 items-center rounded-[4px] bg-[var(--rm-btn-bg)] px-4 text-[13px] font-medium text-[var(--rm-btn-fg)] no-underline transition-[opacity,transform] duration-150 ease-[var(--ease-out)] hover:opacity-90 active:scale-[0.96]"
					>
						Start building
					</Link>
					<Link
						to="/login"
						className="inline-flex h-9 items-center rounded-[4px] border border-[var(--rm-line-strong)] px-4 text-[13px] font-medium text-[var(--rm-fg-2)] no-underline transition-[color,transform] duration-150 ease-[var(--ease-out)] hover:border-[var(--rm-line-strong)] hover:text-[var(--rm-fg)] active:scale-[0.96]"
					>
						Log in
					</Link>
				</div>
			</div>
		</section>
	)
}
