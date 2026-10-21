import { Link } from "react-router-dom"
import { LogoIcon } from "@/components/logo"
import { container } from "./constants"

const columns = [
	{
		title: "Platform",
		items: [
			{ label: "How it works", href: "/#how-it-works" },
			{ label: "Control room", href: "/#control-room" },
			{ label: "Policies", href: "/policies" },
			{ label: "Audit", href: "/audit" },
			{ label: "Grants", href: "/grants" },
		],
	},
	{
		title: "Resources",
		items: [
			{ label: "Use cases", href: "/#use-cases" },
			{ label: "Integrations", href: "/#integrations" },
			{ label: "Open source", href: "/#open-source" },
			{ label: "FAQ", href: "/#faq" },
		],
	},
	{
		title: "Company",
		items: [
			{ label: "Workspace", href: "/workspace" },
			{ label: "GitHub", href: "https://github.com/Daviduche03/Runmesh" },
			{ label: "Changelog", href: "https://github.com/Daviduche03/Runmesh/commits/main" },
			{ label: "Contributing", href: "https://github.com/Daviduche03/Runmesh/blob/main/CONTRIBUTING.md" },
		],
	},
]

export function Footer() {
	return (
		<footer className="border-t border-[var(--rm-ink-line)] bg-[var(--rm-ink)] pb-10">
			<div className={`${container} grid gap-12 pt-16 lg:grid-cols-[1.6fr_repeat(3,1fr)]`}>
				<div>
					<Link
						to="/"
						className="flex items-center gap-2.5 text-[15px] font-medium text-[var(--rm-ink-fg)] no-underline"
					>
						<LogoIcon className="size-5 text-[var(--rm-ink-accent)]" />
						<span className="font-sans font-medium">Runmesh</span>
					</Link>
					<p className="mt-5 max-w-[300px] text-[14px] leading-6 text-[var(--rm-ink-muted)]">
						The control plane for AI agents: identity, access, approvals, and audit in one layer.
					</p>
					<p className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--rm-ink-muted)]">
						MIT licensed
					</p>
				</div>

				{columns.map(({ title, items }) => (
					<div className="grid content-start gap-3.5" key={title}>
						<h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--rm-ink-muted)]">
							{title}
						</h3>
						{items.map((item) => {
							const external = item.href.startsWith("http")
							const content = (
								<>
									{item.label}
									{external ? (
										<svg
											viewBox="0 0 12 12"
											className="ml-1 inline-block size-2.5 -translate-y-px fill-none stroke-current"
											strokeWidth="1.3"
											aria-hidden="true"
										>
											<path d="M4.5 2.5h5v5" />
											<path d="M9.5 2.5 3 9" />
										</svg>
									) : null}
								</>
							)
							const className =
								"text-[14px] text-[var(--rm-ink-muted)] no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-ink-fg)]"
							return external ? (
								<a key={item.label} href={item.href} className={className} target="_blank" rel="noreferrer">
									{content}
								</a>
							) : (
								<Link key={item.label} to={item.href} className={className}>
									{content}
								</Link>
							)
						})}
					</div>
				))}
			</div>

			<div
				className={`${container} mt-14 flex flex-col gap-3 border-t border-[var(--rm-ink-line)] pt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rm-ink-muted)] sm:flex-row sm:items-center sm:justify-between`}
			>
				<span>© {new Date().getFullYear()} Runmesh Inc.</span>
				<span className="flex gap-5">
					<a
						href="https://github.com/Daviduche03/Runmesh/blob/main/SECURITY.md"
						target="_blank"
						rel="noreferrer"
						className="text-inherit no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-ink-fg)]"
					>
						Security
					</a>
					<a
						href="https://github.com/Daviduche03/Runmesh/blob/main/CONTRIBUTING.md"
						target="_blank"
						rel="noreferrer"
						className="text-inherit no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-ink-fg)]"
					>
						Contributing
					</a>
				</span>
			</div>
		</footer>
	)
}
