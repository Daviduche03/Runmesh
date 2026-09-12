import { container } from "./constants"
import { SectionHeading } from "@/components/landing-page/section-heading"

const defaultDevignore = `# .devignore — files and directories to exclude from sync
.git/
node_modules/
build/
dist/
target/
.cache/
__pycache__/
*.pyc
.next/
.venv/
.env
vendor/
.idea/
*.swp
*.swo
.DS_Store
Thumbs.db`

export function DevignoreSection() {
	return (
		<section id="devignore" className="scroll-mt-14 border-b border-[var(--rm-line)] py-24 lg:py-32">
			<div className={container}>
				<SectionHeading index="02" label=".devignore" title="Dev-aware sync for real repositories">
					A .devignore file in your project root uses standard gitignore syntax to keep build artifacts,
					dependencies, secrets, and OS junk out of the cloud context agents consume.
				</SectionHeading>

				<div className="mt-14 grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-start lg:gap-16">
					<div className="space-y-6 text-[15px] leading-7 text-[var(--rm-muted)]">
						<div>
							<h3 className="font-display text-[16px] font-medium tracking-[-0.01em] text-[var(--rm-fg)]">
								Created automatically
							</h3>
							<p className="mt-2">
								<span className="font-mono text-[13px] text-[var(--rm-accent)]">runmesh link</span> generates a
								sensible default. Edit it anytime; patterns are applied via rclone filters on every sync.
							</p>
						</div>
						<div>
							<h3 className="font-display text-[16px] font-medium tracking-[-0.01em] text-[var(--rm-fg)]">
								Same syntax as .gitignore
							</h3>
							<p className="mt-2">Wildcards, directory-only patterns, negation — everything works as expected.</p>
						</div>
					</div>

					<div className="overflow-hidden border border-[var(--rm-line)] bg-[var(--rm-panel)]">
						<div className="flex items-center justify-between border-b border-[var(--rm-line)] px-4 py-2.5">
							<span className="font-mono text-[11px] text-[var(--rm-faint)]">.devignore</span>
							<span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--rm-faint)]">gitignore</span>
						</div>
						<pre className="overflow-x-auto p-5 font-mono text-[12.5px] leading-6 text-[var(--rm-fg-2)]">
							<code>{defaultDevignore}</code>
						</pre>
					</div>
				</div>
			</div>
		</section>
	)
}
