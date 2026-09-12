import type React from "react"
import { Link } from "react-router-dom"
import { LogoIcon } from "@/components/logo"
import { SectionLabel } from "@/components/landing-page/section-label"
import { WindowImage } from "@/components/landing-page/window-image"

export function AuthLayout({
	title,
	subtitle,
	loading,
	onGitHub,
	footer,
}: {
	title: string
	subtitle: string
	loading: boolean
	onGitHub: () => void
	footer: React.ReactNode
}) {
	return (
		<main className="rm-surface min-h-screen bg-[var(--rm-bg)] font-sans text-[var(--rm-fg)] antialiased">
			<div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
				<div className="hidden flex-col justify-between gap-10 border-r border-[var(--rm-line)] p-10 lg:flex xl:p-14">
					<Link
						to="/"
						className="flex w-fit items-center gap-2.5 text-[15px] font-medium text-[var(--rm-fg)] no-underline"
					>
						<LogoIcon className="size-5 text-[var(--rm-accent)]" />
						<span className="font-display">Runmesh</span>
					</Link>

					<div>
						<SectionLabel index="AUTH">Durable agent infrastructure</SectionLabel>
						<h2 className="mt-6 max-w-[460px] text-balance font-display text-[clamp(28px,3vw,40px)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--rm-fg)]">
							Queue webhooks. Schedule tasks. Inspect every run.
						</h2>
						<p className="mt-5 max-w-[420px] text-[15px] leading-7 text-[var(--rm-muted)]">
							Durable actions, agent workflows, delegated access, and workspace context behind one dashboard and
							API.
						</p>
					</div>

					<div className="border border-[var(--rm-line)] bg-[var(--rm-panel)] p-2">
						<WindowImage base="ui-2" alt="Runmesh agent actions list" />
					</div>
				</div>

				<div className="flex min-h-screen items-center justify-center px-6 py-12">
					<div className="w-full max-w-[380px]">
						<LogoIcon className="mb-6 size-6 text-[var(--rm-accent)] lg:hidden" />
						<h1 className="font-display text-[clamp(24px,4vw,30px)] font-medium leading-tight tracking-[-0.03em] text-[var(--rm-fg)]">
							{title}
						</h1>
						<p className="mt-2 text-[15px] leading-6 text-[var(--rm-muted)]">{subtitle}</p>

						<button
							onClick={onGitHub}
							disabled={loading}
							className="mt-8 inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-[4px] bg-[var(--rm-btn-bg)] text-[13px] font-medium text-[var(--rm-btn-fg)] transition-opacity hover:opacity-90 disabled:opacity-60"
						>
							<svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
								<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
							</svg>
							{loading ? "Redirecting..." : "Continue with GitHub"}
						</button>

						<div className="mt-6 text-[14px] text-[var(--rm-muted)]">{footer}</div>

						<div className="mt-8 border-t border-[var(--rm-line)] pt-4">
							<Link
								to="/"
								className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--rm-faint)] no-underline transition-colors hover:text-[var(--rm-fg)]"
							>
								← Back to home
							</Link>
						</div>
					</div>
				</div>
			</div>
		</main>
	)
}
