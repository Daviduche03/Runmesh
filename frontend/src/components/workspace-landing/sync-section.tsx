import { container } from "./constants"
import { SectionHeading } from "@/components/landing-page/section-heading"
import { WindowImage } from "@/components/landing-page/window-image"

const commands = [
	["runmesh up", "Push local changes to the bucket, respecting .devignore."],
	["runmesh down", "Pull the latest cloud state to any machine or sandbox."],
	["runmesh watch", "Continuous two-way sync while you work."],
	["runmesh status", "Diff local vs cloud and catch drift before it spreads."],
]

export function SyncSection() {
	return (
		<section id="sync" className="scroll-mt-14 border-b border-[var(--rm-line)] py-28 lg:py-36">
			<div className={container}>
				<SectionHeading index="01" label="Sync" title="Keep project context ready for every actor">
					Your files live in an S3-compatible bucket — Cloudflare R2, AWS S3, Minio, or any provider. Developers
					and agents pick up the same workspace without routing every handoff through git.
				</SectionHeading>

				<div className="mt-14 grid gap-px bg-[var(--rm-line)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
					<div className="bg-[var(--rm-bg)] p-6 lg:p-8">
						<WindowImage base="ui-11" alt="Workspace sync status and file diff" />
					</div>
					<div className="bg-[var(--rm-bg)] p-6 lg:p-8">
						<dl className="divide-y divide-[var(--rm-line)]">
							{commands.map(([cmd, desc]) => (
								<div className="py-4 first:pt-0 last:pb-0" key={cmd}>
									<dt className="font-mono text-[13px] text-[var(--rm-accent)]">{cmd}</dt>
									<dd className="mt-1.5 text-[14px] leading-6 text-[var(--rm-muted)]">{desc}</dd>
								</div>
							))}
						</dl>
					</div>
				</div>
			</div>
		</section>
	)
}
