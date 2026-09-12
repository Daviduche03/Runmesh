import { container } from "./constants"
import { SectionHeading } from "./section-heading"
import { WindowImage } from "./window-image"

const rows = [
	["Task states", "queued, running, completed, failed, or cancelled"],
	["Scheduling", "run now, or at a future UTC time. Workflows also run on cron."],
	["Retries", "automatic retries with idempotency keys, so a retry never duplicates work"],
	["Dead letters", "failed outbound webhooks are stored and can be replayed"],
	["Auth", "dashboard sessions (JWT) and scoped API keys for integrations"],
]

export function Observability() {
	return (
		<section id="observability" className="scroll-mt-14 border-b border-[var(--rm-line)] py-28 lg:py-36">
			<div className={container}>
				<SectionHeading index="02" label="Dashboard" title="Every task, run, and webhook in one view">
					Once work leaves the request, you still need to see it. Runmesh records each task and gives you analytics,
					API keys, and outbound webhook delivery in the same dashboard.
				</SectionHeading>

				<div className="mt-14 grid gap-px bg-[var(--rm-line)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
					<div className="bg-[var(--rm-bg)] p-6 lg:p-8">
						<WindowImage base="ui-5" alt="Analytics for task volume, completion, and failures" />
					</div>
					<div className="bg-[var(--rm-bg)] p-6 lg:p-8">
						<dl className="divide-y divide-[var(--rm-line)]">
							{rows.map(([term, detail]) => (
								<div className="grid grid-cols-[110px_1fr] gap-4 py-4 first:pt-0 last:pb-0" key={term}>
									<dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--rm-faint)]">
										{term}
									</dt>
									<dd className="text-[14px] leading-6 text-[var(--rm-muted)]">{detail}</dd>
								</div>
							))}
						</dl>
					</div>
				</div>
			</div>
		</section>
	)
}
