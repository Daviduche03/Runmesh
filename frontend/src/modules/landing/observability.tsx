import { container } from "./constants"
import { SectionHeading } from "./section-heading"
import { ProductShot } from "@/components/product-shot"

const rows = [
	["Agent", "each action tied to an agent, task, or workflow run"],
	["Grant", "scope, resource, expiry, and use count on every token"],
	["Approval", "who approved what, and when — humans and policy alike"],
	["Actions", "every task, run, and webhook with its full input and output"],
	["Replay", "failed outbound webhooks stored and replayable"],
]

export function Observability() {
	return (
		<section id="observability" className="scroll-mt-14 border-b border-[var(--rm-line)] py-28 lg:py-36">
			<div className={container}>
				<SectionHeading index="02" label="Audit" title="Every action recorded, every token explainable">
					When an agent acts, you need the receipt: which agent, on whose behalf, with what scope, approved by whom —
					and what it actually did.
				</SectionHeading>

				<div className="mt-14 grid gap-px bg-[var(--rm-line)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
					<div className="bg-[var(--rm-bg)] p-6 lg:p-8">
						<ProductShot variant="audit" />
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
