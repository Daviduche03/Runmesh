import { container } from "./constants"
import { Eyebrow } from "./primitives"

const endpoints = [
	["POST", "/api/v1/connect/token", "Mint a scoped, expiring grant"],
	["POST", "/api/v1/tasks", "Queue a durable action"],
	["GET", "/api/v1/connect/audit", "Read the ledger"],
	["POST", "/api/v1/policies/evaluate", "Test a decision"],
]

export function Developers() {
	return (
		<section id="developers" className="scroll-mt-16 border-t border-[var(--rm-line)] py-20 lg:py-28">
			<div className={container}>
				<div className="grid gap-12 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-16">
					<div>
						<Eyebrow>For developers</Eyebrow>
						<h2 className="mt-5 text-balance font-display text-[clamp(28px,3.6vw,44px)] font-medium leading-[1.08] tracking-[-0.03em] text-[var(--rm-fg)]">
							One small API for identity, access, and execution
						</h2>
						<p className="mt-5 text-pretty text-[16px] leading-7 text-[var(--rm-muted)]">
							Every endpoint shares one response envelope. Authenticate with a bearer token for the
							dashboard, or an API key for your integrations. No SDK required to get started.
						</p>

						<dl className="mt-8 divide-y divide-[var(--rm-line)] border-y border-[var(--rm-line)]">
							{endpoints.map(([method, path, description]) => (
								<div className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 py-3.5" key={path}>
									<dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--rm-accent)]">
										{method}
									</dt>
									<dd className="min-w-0">
										<code className="block truncate font-mono text-[13px] text-[var(--rm-fg)]">
											{path}
										</code>
										<span className="text-[13.5px] text-[var(--rm-muted)]">{description}</span>
									</dd>
								</div>
							))}
						</dl>
					</div>

					<div className="overflow-hidden rounded-xl border border-[var(--rm-line)] bg-[var(--rm-ink)] shadow-[0_18px_48px_-24px_rgba(20,19,17,0.35)]">
						<div className="flex h-10 items-center gap-2 border-b border-[var(--rm-ink-line)] px-4">
							<span className="size-2.5 rounded-full bg-[#ff5f57]" />
							<span className="size-2.5 rounded-full bg-[#febc2e]" />
							<span className="size-2.5 rounded-full bg-[#28c840]" />
							<span className="ml-2 font-mono text-[12px] text-[var(--rm-ink-muted)]">token.sh</span>
						</div>
						<pre className="overflow-x-auto px-5 py-5 font-mono text-[12.5px] leading-[1.75] text-[var(--rm-ink-2)]">
							<span className="text-[var(--rm-ink-muted)]"># Mint a scoped, expiring grant for one agent</span>{"\n"}
							<span className="text-[var(--rm-ink-muted)]"># and one repo. The agent never sees the secret.</span>{"\n\n"}
							<span className="text-[var(--rm-ink-accent)]">curl</span> -X POST <span className="text-[var(--rm-ink-2)]">https://api.runmesh.dev</span>
							<span className="text-[var(--rm-ink-2)]">/api/v1/connect/token</span>{" \\\n"}
							{"  "}-H <span className="text-[#9ece6a]">&quot;Authorization: Bearer $RUNMESH_API_KEY&quot;</span>{" \\\n"}
							{"  "}-H <span className="text-[#9ece6a]">&quot;Content-Type: application/json&quot;</span>{" \\\n"}
							{"  "}-d <span className="text-[#e0af68]">&apos;&#123;</span>{"\n"}
							{"    "}<span className="text-[#7dcfff]">&quot;connection_id&quot;</span>: <span className="text-[#e0af68]">&quot;con_9f2ac4&quot;</span>,{"\n"}
							{"    "}<span className="text-[#7dcfff]">&quot;agent_id&quot;</span>: <span className="text-[#e0af68]">&quot;agt_support&quot;</span>,{"\n"}
							{"    "}<span className="text-[#7dcfff]">&quot;scopes&quot;</span>: [<span className="text-[#e0af68]">&quot;repo.read&quot;</span>, <span className="text-[#e0af68]">&quot;issues.write&quot;</span>],{"\n"}
							{"    "}<span className="text-[#7dcfff]">&quot;resource_filters&quot;</span>: &#123;<span className="text-[#e0af68]">&quot;repos&quot;</span>: [<span className="text-[#e0af68]">&quot;acme/platform&quot;</span>]&#125;,{"\n"}
							{"    "}<span className="text-[#7dcfff]">&quot;max_uses&quot;</span>: <span className="text-[#b48ead]">25</span>,{"\n"}
							{"    "}<span className="text-[#7dcfff]">&quot;valid_until&quot;</span>: <span className="text-[#e0af68]">&quot;2026-10-19T18:00:00Z&quot;</span>{"\n"}
							{"  "}<span className="text-[#e0af68]">&apos;&#125;</span>
						</pre>
						<div className="border-t border-[var(--rm-ink-line)] px-5 py-4 font-mono text-[12.5px] leading-6 text-[var(--rm-ink-muted)]">
							<span className="text-[var(--rm-ink-accent)]">→</span>{" "}
							<span className="text-[var(--rm-ink-2)]">{"{ token, scope, expires_at }"}</span>
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}
