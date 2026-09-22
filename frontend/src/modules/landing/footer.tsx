import { Link } from "react-router-dom"
import { LogoIcon } from "@/components/logo"
import { container } from "./constants"

const columns = [
	{ title: "Product", items: ["Primitives", "Workflows", "Observability", "Security"] },
	{ title: "Developers", items: ["Docs", "API reference", "CLI", "Changelog"] },
	{ title: "Company", items: ["About", "Careers", "Contact", "Blog"] },
]

export function Footer() {
	return (
		<footer className="py-16 lg:py-20">
			<div className={`${container} grid gap-12 lg:grid-cols-[1.5fr_repeat(3,1fr)]`}>
				<div>
					<Link to="/" className="flex items-center gap-2.5 text-[15px] font-medium text-[var(--rm-fg)] no-underline">
						<LogoIcon className="size-5 text-[var(--rm-accent)]" />
						<span className="font-display">Runmesh</span>
					</Link>
					<p className="mt-5 max-w-[260px] text-[14px] leading-6 text-[var(--rm-muted)]">
						The control plane for AI agents — identity, access, approvals, and audit in one layer.
					</p>
					<div className="mt-6 flex gap-5 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--rm-faint)]">
						<Link to="#" className="text-inherit no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-fg)]">X</Link>
						<Link to="#" className="text-inherit no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-fg)]">GitHub</Link>
						<Link to="#" className="text-inherit no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-fg)]">Slack</Link>
					</div>
				</div>
				{columns.map(({ title, items }) => (
					<div className="grid content-start gap-3.5" key={title}>
						<h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--rm-faint)]">{title}</h3>
						{items.map((item) => (
							<Link
								className="text-[14px] text-[var(--rm-muted)] no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-fg)]"
								to="#"
								key={item}
							>
								{item}
							</Link>
						))}
					</div>
				))}
			</div>
			<div className={`${container} mt-14 flex flex-col gap-3 border-t border-[var(--rm-line)] pt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rm-faint)] sm:flex-row sm:items-center sm:justify-between`}>
				<span>© {new Date().getFullYear()} Runmesh</span>
				<span>Status · Security · Privacy</span>
			</div>
		</footer>
	)
}
