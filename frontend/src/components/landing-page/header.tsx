import { Link, useLocation } from "react-router-dom"
import { LogoBadge } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { container } from "./constants"
import { scrollToSection } from "./scroll-to-section"

export function Header() {
	const { pathname } = useLocation()

	return (
		<header className="fixed inset-x-0 top-0 z-20 bg-[#08090a]/80 backdrop-blur-xl supports-backdrop-filter:bg-[#08090a]/60">
			<nav className={`${container} flex h-14 items-center justify-between`}>
				<Link
					to="/"
					className="flex items-center gap-2.5 text-lg font-semibold tracking-tight text-white no-underline"
					aria-label="Runmesh home"
				>
					<LogoBadge />
					<span>Runmesh</span>
				</Link>

				<div className="hidden items-center gap-6 text-sm text-[#9a9da4] lg:flex">
					{[
						["Features", "features"],
						["Task API", "task-api"],
						["Showcase", "resources"],
						["Status", "now"],
						["Contact", "contact"],
					].map(([item, id]) => (
						<Link
							to={`/#${id}`}
							onClick={(e) => {
								if (pathname === "/") {
									e.preventDefault()
									scrollToSection(id)
									window.history.replaceState(null, "", `/#${id}`)
								}
							}}
							className="text-inherit no-underline transition-colors hover:text-white"
							key={item}
						>
							{item}
						</Link>
					))}
				</div>

				<div className="flex items-center gap-4">
					<Link
						to="/login"
						className="hidden border-l border-[#24272d] pl-4 text-sm text-[#9a9da4] no-underline transition-colors hover:text-white md:block"
					>
						Log in
					</Link>
					<Button asChild size="sm" className="h-8 bg-[#f2f2f2] text-[#08090a] hover:bg-white">
						<Link to="/signup">Sign up</Link>
					</Button>
				</div>
			</nav>
		</header>
	)
}
