import { useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { List, X } from "@phosphor-icons/react"
import { LogoIcon } from "@/components/logo"
import { container, headerNavLinks } from "./constants"
import { scrollToSection } from "./scroll-to-section"

export function Header() {
	const { pathname } = useLocation()
	const [open, setOpen] = useState(false)

	const go = (e: React.MouseEvent, id: string) => {
		setOpen(false)
		if (pathname === "/") {
			e.preventDefault()
			scrollToSection(id)
			window.history.replaceState(null, "", `/#${id}`)
		}
	}

	return (
		<header className="sticky top-0 z-40 border-b border-[var(--rm-line)] bg-[var(--rm-bg-trans)] backdrop-blur-xl">
			<nav className={`${container} flex h-16 items-center justify-between gap-6`}>
				<Link
					to="/"
					className="flex items-center gap-2.5 text-[15px] font-medium tracking-[-0.01em] text-[var(--rm-fg)] no-underline"
					aria-label="Runmesh home"
				>
					<LogoIcon className="size-[18px] text-[var(--rm-accent)]" />
					<span className="font-sans font-medium">Runmesh</span>
				</Link>

				<div className="hidden items-center gap-7 text-[14px] text-[var(--rm-muted)] lg:flex">
					{headerNavLinks.map(({ label, id }) => (
						<Link
							to={`/#${id}`}
							onClick={(e) => go(e, id)}
							className="text-inherit no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-fg)]"
							key={id}
						>
							{label}
						</Link>
					))}
					<Link
						to="/workspace"
						className="text-inherit no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-fg)]"
					>
						Workspace
					</Link>
					<a
						href="https://github.com/Daviduche03/Runmesh"
						className="text-inherit no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-fg)]"
					>
						GitHub
					</a>
				</div>

				<div className="flex items-center gap-2">
					<Link
						to="/login"
						className="hidden h-9 items-center rounded-[6px] px-3 text-[14px] text-[var(--rm-muted)] no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-fg)] md:flex"
					>
						Log in
					</Link>
					<Link
						to="/signup"
						className="inline-flex h-9 items-center rounded-[6px] bg-[var(--rm-btn-bg)] px-4 text-[14px] font-medium text-[var(--rm-btn-fg)] no-underline transition-[opacity,transform] duration-150 ease-[var(--ease-out)] hover:opacity-90 active:scale-[0.97]"
					>
						Get started
					</Link>
					<button
						type="button"
						onClick={() => setOpen((v) => !v)}
						aria-expanded={open}
						aria-label={open ? "Close menu" : "Open menu"}
						className="-mr-1 inline-flex size-9 items-center justify-center rounded-[6px] text-[var(--rm-fg)] transition-colors duration-150 hover:bg-[var(--rm-panel)] lg:hidden"
					>
						{open ? <X className="size-5" weight="bold" /> : <List className="size-5" weight="bold" />}
					</button>
				</div>
			</nav>

			{open ? (
				<div className="border-t border-[var(--rm-line)] bg-[var(--rm-bg)] lg:hidden">
					<div className={`${container} grid gap-1 py-4`}>
						{headerNavLinks.map(({ label, id }) => (
							<Link
								to={`/#${id}`}
								onClick={(e) => go(e, id)}
								className="rounded-[6px] px-2 py-2.5 text-[16px] text-[var(--rm-fg-2)] no-underline transition-colors duration-150 hover:bg-[var(--rm-panel)] hover:text-[var(--rm-fg)]"
								key={id}
							>
								{label}
							</Link>
						))}
						<Link
							to="/workspace"
							onClick={() => setOpen(false)}
							className="rounded-[6px] px-2 py-2.5 text-[16px] text-[var(--rm-fg-2)] no-underline transition-colors duration-150 hover:bg-[var(--rm-panel)] hover:text-[var(--rm-fg)]"
						>
							Workspace
						</Link>
						<a
							href="https://github.com/Daviduche03/Runmesh"
							className="rounded-[6px] px-2 py-2.5 text-[16px] text-[var(--rm-fg-2)] no-underline transition-colors duration-150 hover:bg-[var(--rm-panel)] hover:text-[var(--rm-fg)]"
						>
							GitHub
						</a>
						<Link
							to="/login"
							onClick={() => setOpen(false)}
							className="rounded-[6px] px-2 py-2.5 text-[16px] text-[var(--rm-fg-2)] no-underline transition-colors duration-150 hover:bg-[var(--rm-panel)] hover:text-[var(--rm-fg)] md:hidden"
						>
							Log in
						</Link>
					</div>
				</div>
			) : null}
		</header>
	)
}
