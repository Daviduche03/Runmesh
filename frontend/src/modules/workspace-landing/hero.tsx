import { Link } from "react-router-dom"
import { container } from "./constants"
import { SectionLabel } from "@/modules/landing/section-label"
import { ProductShot } from "@/components/product-shot"

const facts = [
	{ k: "sync", v: "up · down · watch" },
	{ k: "secrets", v: ".env encrypted, AES-256-GCM" },
	{ k: "ignore", v: ".devignore, gitignore syntax" },
]

export function Hero() {
	return (
		<section className="relative border-b border-[var(--rm-line)] pt-32 pb-16 lg:pt-40 lg:pb-20">
			<div className={container}>
				<div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:items-end">
					<div>
						<SectionLabel index="00">Runmesh Workspace</SectionLabel>
						<h1 className="mt-6 max-w-[760px] text-balance font-display text-[clamp(38px,5vw,64px)] font-medium leading-[1.02] tracking-[-0.03em] text-[var(--rm-fg)]">
							Your project files, on every device
						</h1>
						<p className="mt-6 max-w-[560px] text-[17px] leading-7 tracking-[-0.01em] text-[var(--rm-muted)]">
							Sync a project to S3-compatible storage — Cloudflare R2, AWS S3, Minio — keep build artifacts out
							with .devignore, and carry your .env secrets encrypted. One CLI, no commits, no stale copies.
						</p>
						<div className="mt-8 flex items-center gap-3">
							<Link
								to="/signup"
								className="inline-flex h-9 items-center rounded-[4px] bg-[var(--rm-btn-bg)] px-4 text-[13px] font-medium text-[var(--rm-btn-fg)] no-underline transition-opacity hover:opacity-90"
							>
								Get started
							</Link>
							<Link
								to="/workspace#cli"
								className="inline-flex h-9 items-center rounded-[4px] border border-[var(--rm-line-strong)] px-4 text-[13px] font-medium text-[var(--rm-fg-2)] no-underline transition-colors hover:text-[var(--rm-fg)]"
							>
								Install the CLI
							</Link>
						</div>
					</div>

					<dl className="grid gap-y-4 border-t border-[var(--rm-line)] pt-6 lg:border-t-0 lg:pt-0">
						{facts.map((fact) => (
							<div className="flex flex-col gap-1" key={fact.k}>
								<dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--rm-faint)]">
									{fact.k}
								</dt>
								<dd className="font-mono text-[13px] text-[var(--rm-fg-2)]">{fact.v}</dd>
							</div>
						))}
					</dl>
				</div>

				<div className="mt-14 border border-[var(--rm-line)] bg-[var(--rm-panel)] p-3 lg:mt-16">
					<ProductShot variant="terminal" />
				</div>
			</div>
		</section>
	)
}
