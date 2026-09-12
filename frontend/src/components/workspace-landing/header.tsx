import { Link, useLocation } from "react-router-dom"
import { LogoIcon } from "@/components/logo"
import { container, headerNavLinks } from "./constants"
import { scrollToSection } from "./scroll-to-section"

export function Header() {
	const { pathname } = useLocation()

	return (
		<header className="fixed inset-x-0 top-0 z-30 border-b border-[var(--rm-line)] bg-[var(--rm-bg-trans)] backdrop-blur-md">
			<nav className={`${container} flex h-14 items-center justify-between`}>
				<Link
					to="/workspace"
					className="flex items-center gap-2.5 text-[15px] font-medium tracking-[-0.01em] text-[var(--rm-fg)] no-underline"
					aria-label="Runmesh Workspace home"
				>
					<LogoIcon className="size-5 text-[var(--rm-accent)]" />
					<span className="font-display">
						Runmesh <span className="text-[var(--rm-muted)]">Workspace</span>
					</span>
				</Link>

				<div className="hidden items-center gap-7 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--rm-muted)] lg:flex">
					{headerNavLinks.map(({ label, id }) => (
						<Link
							to={`/workspace#${id}`}
							onClick={(e) => {
								if (pathname === "/workspace") {
									e.preventDefault()
									scrollToSection(id)
									window.history.replaceState(null, "", `/workspace#${id}`)
								}
							}}
							className="text-inherit no-underline transition-colors hover:text-[var(--rm-fg)]"
							key={id}
						>
							{label}
						</Link>
					))}
					<Link to="/" className="text-inherit no-underline transition-colors hover:text-[var(--rm-fg)]">
						Runmesh
					</Link>
				</div>

				<div className="flex items-center gap-5">
					<Link
						to="/login"
						className="hidden font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--rm-muted)] no-underline transition-colors hover:text-[var(--rm-fg)] md:block"
					>
						Log in
					</Link>
					<Link
						to="/signup"
						className="inline-flex h-8 items-center rounded-[4px] bg-[var(--rm-btn-bg)] px-3.5 text-[12px] font-medium text-[var(--rm-btn-fg)] no-underline transition-opacity hover:opacity-90"
					>
						Start building
					</Link>
				</div>
			</nav>
		</header>
	)
}
