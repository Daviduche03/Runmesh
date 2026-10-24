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

const legal = [
	{ label: "Security", href: "https://github.com/Daviduche03/Runmesh/blob/main/SECURITY.md" },
	{ label: "Contributing", href: "https://github.com/Daviduche03/Runmesh/blob/main/CONTRIBUTING.md" },
	{ label: "GitHub", href: "https://github.com/Daviduche03/Runmesh" },
]

export function Footer() {
	return (
		<footer className="relative overflow-hidden bg-black">
			<div className={container}>
				<div className="grid gap-12 pt-16 lg:grid-cols-[1.5fr_repeat(3,1fr)] lg:gap-10 lg:pt-20">
					<div>
						<Link to="/" className="inline-flex items-center gap-2.5 text-[var(--rm-ink-fg)] no-underline">
							<LogoIcon className="size-5 text-[var(--rm-accent)]" />
							<span className="font-display-sans text-[19px] font-medium tracking-[-0.02em]">Runmesh</span>
						</Link>
						<p className="mt-5 max-w-[300px] text-[14px] leading-6 text-[var(--rm-ink-muted)]">
							The control plane for AI agents: identity, access, approvals, and audit in one layer.
						</p>
						<p className="mt-6 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--rm-ink-muted)]">
							MIT licensed
						</p>
					</div>

					{columns.map(({ title, items }) => (
						<div className="grid content-start gap-3.5" key={title}>
							<h3 className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[var(--rm-ink-muted)]/80">
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
									<a
										key={item.label}
										href={item.href}
										className={className}
										target="_blank"
										rel="noreferrer"
									>
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

				<div className="mt-16 flex flex-col gap-4 pb-6 sm:flex-row sm:items-center sm:justify-between">
					<span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rm-ink-muted)]">
						© {new Date().getFullYear()} Runmesh
					</span>
					<span className="flex flex-wrap gap-6">
						{legal.map((item) => (
							<a
								key={item.label}
								href={item.href}
								target="_blank"
								rel="noreferrer"
								className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--rm-ink-muted)] no-underline transition-[color] duration-150 ease-[var(--ease-out)] hover:text-[var(--rm-ink-fg)]"
							>
								{item.label}
							</a>
						))}
					</span>
				</div>
			</div>

			<div aria-hidden="true" className={`${container} select-none pt-8`}>
				<span className="block pb-8 font-display-sans text-[clamp(72px,13vw,176px)] font-medium leading-[0.95] tracking-[-0.055em] text-white/[0.07]">
					Runmesh
				</span>
			</div>
		</footer>
	)
}
