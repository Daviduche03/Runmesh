import { container, sectionY } from "./constants"
import { SectionHeading } from "./section-heading"

const specs = [
	["Tasks", "GET/POST /api/v1/tasks · POST /api/v1/tasks/schedule"],
	["Workflows", "GET/POST /api/v1/workflows · PUT /api/v1/workflows/{id}/graph · POST /api/v1/workflows/{id}/trigger"],
	["Connect", "POST /api/v1/connect/apps · /sessions · /otp/verify · POST /api/v1/connect/token"],
	["Auth", "Authorization: Bearer <jwt> for the dashboard, X-API-Key: rk_… for integrations"],
	["Templates", "Jinja2 url_template and payload_template rendered at execution time"],
	["Runtime", "Cloudflare Workers (Python), D1 for storage, Queues runmesh-tasks & runmesh-webhooks"],
]

export function Technical() {
	return (
		<section id="technical" className={`scroll-mt-14 border-b border-[var(--rm-line)] ${sectionY}`}>
			<div className={container}>
				<SectionHeading index="04" label="Under the hood" title="An API you can read in one sitting">
					The whole platform is a small, consistent HTTP API. No SDK required to get started.
				</SectionHeading>

				<div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
					<div className="space-y-5 text-[15px] leading-7 text-[var(--rm-muted)]">
						<p>
							Runmesh runs on Cloudflare Workers with D1 for storage and Queues for dispatch. Every JSON endpoint
							shares one response envelope.
						</p>
						<p>
							Tasks and workflows are both queued work. A task is one HTTP call to a URL you choose. A workflow is a
							graph of those calls, with Jinja templates rendered between steps.
						</p>
						<p className="font-mono text-[13px] leading-6 text-[var(--rm-faint)]">
							POST /api/v1/tasks → {"{ task_id, status: \"queued\" }"}
						</p>
					</div>

					<dl className="divide-y divide-[var(--rm-line)] border-y border-[var(--rm-line)]">
						{specs.map(([term, detail]) => (
							<div className="grid gap-2 py-5 sm:grid-cols-[140px_1fr] sm:gap-8" key={term}>
								<dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--rm-faint)]">
									{term}
								</dt>
								<dd className="break-words font-mono text-[13px] leading-6 text-[var(--rm-fg-2)]">{detail}</dd>
							</div>
						))}
					</dl>
				</div>
			</div>
		</section>
	)
}
