import { motion } from "framer-motion"
import { SectionIntro } from "./section-intro"
import { container, sectionPadding } from "./constants"

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
Thumbs.db
`

export function DevignoreSection() {
	return (
		<section id="devignore" className={`scroll-mt-14 border-b border-[#15181d] ${sectionPadding}`}>
			<div className={container}>
				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1] }}
				>
					<SectionIntro badge=".devignore" title="Dev-aware sync for real repositories">
						A <code className="rounded bg-[#161616] px-1.5 py-0.5 text-[15px] text-[#d8dce3]">.devignore</code> file in your project root uses standard
						gitignore syntax to keep build artifacts, dependencies, secrets, and OS junk out of the cloud context agents consume.
					</SectionIntro>
				</motion.div>

				<motion.div
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-80px" }}
					transition={{ duration: 0.7, ease: [0.21, 0.98, 0.35, 1], delay: 0.15 }}
					className="mt-12 grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-center"
				>
					<div>
						<h3 className="text-[18px] font-[590] tracking-[-0.01em] text-[#d8dce3]">Created automatically</h3>
						<p className="mt-2 text-[15px] leading-6 text-[#8f949e]">
							When you run <code className="rounded bg-[#161616] px-1.5 py-0.5 text-[14px] text-[#d8dce3]">runmesh link</code>, a sensible
							default <code className="rounded bg-[#161616] px-1.5 py-0.5 text-[14px] text-[#d8dce3]">.devignore</code> is generated. Edit it
							anytime. Patterns are applied via rclone filters during every sync operation.
						</p>
						<h3 className="mt-8 text-[18px] font-[590] tracking-[-0.01em] text-[#d8dce3]">Same syntax as .gitignore</h3>
						<p className="mt-2 text-[15px] leading-6 text-[#8f949e]">
							Wildcards, directory-only patterns, negation — everything works the way you expect.
						</p>
					</div>

					<div className="overflow-hidden rounded-lg border border-[#24272d] bg-[#0d0e10]">
						<div className="flex items-center gap-2 border-b border-[#24272d] px-4 py-2.5">
							<span className="size-2.5 rounded-full bg-[#ff5f56]" />
							<span className="size-2.5 rounded-full bg-[#ffbd2e]" />
							<span className="size-2.5 rounded-full bg-[#27c93f]" />
							<span className="ml-2 text-[12px] text-[#595a5c]">.devignore</span>
						</div>
						<pre className="overflow-x-auto p-4 text-[13px] leading-5 text-[#c9cdd4]">
							<code>{defaultDevignore}</code>
						</pre>
					</div>
				</motion.div>
			</div>
		</section>
	)
}
