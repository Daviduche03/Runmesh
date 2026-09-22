import { container, sectionY } from "./constants"
import { SectionHeading } from "./section-heading"

const specs = [
	["Identity", "POST /api/v1/connect/apps · agents, sessions, and email OTP / OAuth"],
	["Access", "POST /api/v1/connect/token · grants carry scope, resource, and expiry"],
	["Approvals", "approval gates on grants and on workflow steps"],
	["Execution", "GET/POST /api/v1/tasks · /workflows · UTC schedules and cron triggers"],
	["Auth", "Authorization: Bearer <jwt> · X-API-Key: rk_… for integrations"],
	["Runtime", "Cloudflare Workers (Python), D1 for storage, Queues runmesh-tasks & runmesh-webhooks"],
]

export function Technical() {
	return (
		<section id="technical" className={`scroll-mt-14 border-b border-[var(--rm-line)] ${sectionY}`}>
			<div className={container}>
				<SectionHeading index="04" label="Under the hood" title="One small API for identity, access, and execution">
					The whole control plane is a consistent HTTP API. No SDK required to get started.
				</SectionHeading>

				<div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
					<div className="space-y-5 text-[15px] leading-7 text-[var(--rm-muted)]">
						<p>
							Runmesh runs on Cloudflare Workers with D1 for storage and Queues for dispatch. Every JSON endpoint
							shares one response envelope.
						</p>
						<p>
							An agent asks for access, Runmesh checks the grant and its policy, a human approves when policy
							requires it, and the action runs on durable queues with a full audit record.
						</p>
						<p className="font-mono text-[13px] leading-6 text-[var(--rm-faint)]">
							POST /api/v1/connect/token → {"{ token, scope, expires_at }"}
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
