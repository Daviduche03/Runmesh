import { container } from "./constants"
import { SectionHeading } from "@/modules/landing/section-heading"

const upcoming = [
	["FUSE mount", "Mount the bucket as a local filesystem with on-demand reads."],
	["Lazy loading", "Fetch files only when they are opened, so large projects stay usable."],
	["runmesh clone", "Pull an existing cloud project to a fresh machine in one command."],
	["Conflict handling", "Resolve simultaneous edits across devices instead of last-write-wins."],
	["Agent sandboxes", "Ephemeral sandboxes with the synced project mounted for isolated execution."],
]

export function RoadmapSection() {
	return (
		<section id="roadmap" className="scroll-mt-14 border-b border-[var(--rm-line)] py-24 lg:py-32">
			<div className={container}>
				<SectionHeading index="05" label="Roadmap" title="Sync today, filesystem and sandboxes next">
					The current release is the storage layer: sync, .devignore, and encrypted secrets. These are next, in the
					order we plan to ship them.
				</SectionHeading>

				<dl className="mt-14 divide-y divide-[var(--rm-line)] border-y border-[var(--rm-line)]">
					{upcoming.map(([term, detail]) => (
						<div className="grid gap-2 py-5 sm:grid-cols-[180px_1fr_auto] sm:items-baseline sm:gap-8" key={term}>
							<dt className="font-display text-[16px] font-medium tracking-[-0.01em] text-[var(--rm-fg)]">
								{term}
							</dt>
							<dd className="text-[14px] leading-6 text-[var(--rm-muted)]">{detail}</dd>
							<span className="w-fit rounded-[3px] border border-[var(--rm-line-strong)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rm-faint)]">
								planned
							</span>
						</div>
					))}
				</dl>
			</div>
		</section>
	)
}
