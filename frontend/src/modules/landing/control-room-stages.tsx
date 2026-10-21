import type React from "react"
import { Check, Clock, Robot, ShieldCheck, X } from "@phosphor-icons/react"

const rowShadow = "shadow-[0_1px_2px_rgba(20,19,17,0.04),0_14px_30px_-24px_rgba(20,19,17,0.45)]"

function Stage({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-[400px] w-full min-w-0 items-center justify-center rounded-xl bg-[var(--rm-panel)] p-6 sm:p-8 lg:p-10">
			{children}
		</div>
	)
}

function Row({
	icon,
	tone,
	title,
	meta,
	right,
}: {
	icon: React.ReactNode
	tone: string
	title: string
	meta: string
	right?: React.ReactNode
}) {
	return (
		<div
			className={`flex min-w-0 items-center gap-3 rounded-xl bg-white px-4 py-4 ring-1 ring-black/[0.04] ${rowShadow}`}
		>
			<span className={`grid size-9 shrink-0 place-items-center rounded-lg ${tone}`}>{icon}</span>
			<div className="min-w-0 flex-1">
				<div className="truncate text-[14px] font-medium leading-5 text-[var(--rm-fg)]">{title}</div>
				<div className="truncate font-mono text-[12px] leading-4 text-[var(--rm-muted)]">{meta}</div>
			</div>
			{right}
		</div>
	)
}

export function GrantsStage() {
	return (
		<Stage>
			<div className="w-full max-w-[420px] space-y-2.5">
				<Row
					icon={<Robot className="size-4.5 text-[var(--rm-accent)]" weight="fill" />}
					tone="bg-[rgba(194,73,31,0.09)]"
					title="triage-bot"
					meta="issues:write · acme/api"
					right={<span className="font-mono text-[11px] text-[var(--rm-faint)]">9m</span>}
				/>
				<Row
					icon={<Robot className="size-4.5 text-[var(--rm-muted)]" weight="fill" />}
					tone="bg-[var(--rm-panel-2)]"
					title="repo-watch"
					meta="repo:read · acme/api"
					right={<span className="font-mono text-[11px] text-[var(--rm-faint)]">standing</span>}
				/>
				<Row
					icon={<Robot className="size-4.5 text-amber-700" weight="fill" />}
					tone="bg-amber-50"
					title="triage-bot"
					meta="pull_requests:write · acme/docs"
					right={
						<span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-medium text-amber-700">
							consent
						</span>
					}
				/>
			</div>
		</Stage>
	)
}

export function PoliciesStage() {
	return (
		<Stage>
			<div className="w-full max-w-[352px]">
				<div className={`rounded-xl bg-white p-4 ring-1 ring-black/[0.04] ${rowShadow}`}>
					<div className="flex items-center gap-2">
						<ShieldCheck className="size-4 text-[var(--rm-accent)]" weight="fill" />
						<span className="text-[13.5px] font-semibold tracking-[-0.01em] text-[var(--rm-fg)]">
							Outside standing grant
						</span>
					</div>
					<p className="mt-2 text-[12.5px] leading-5 text-[var(--rm-muted)]">
						No rule allows this request, so a person decides.
					</p>
					<ul className="mt-3 space-y-1.5 border-t border-[var(--rm-line)] pt-3">
						{["requests issues:write on acme/api", "waits for dev@helios.dev", "expires in 9 minutes"].map(
							(item) => (
								<li className="flex items-start gap-2 text-[12.5px] leading-5 text-[var(--rm-fg-2)]" key={item}>
									<Check className="mt-0.5 size-3.5 shrink-0 text-[var(--rm-muted)]" weight="bold" />
									{item}
								</li>
							)
						)}
					</ul>
				</div>

				<div className="mt-4 flex flex-col items-center gap-2">
					<span className="inline-flex items-center gap-2 rounded-full bg-white w-[152px] justify-center px-5 py-2 text-[13px] text-[var(--rm-fg-2)] ring-1 ring-black/[0.05]">
						<Check className="size-3.5 text-emerald-600" weight="bold" />
						Allow
					</span>
					<span className="inline-flex items-center gap-2 rounded-full bg-[var(--rm-fg)] w-[152px] justify-center px-5 py-2 text-[13px] font-medium text-white">
						<Clock className="size-3.5" weight="fill" />
						Consent
					</span>
					<span className="inline-flex items-center gap-2 rounded-full bg-white w-[152px] justify-center px-5 py-2 text-[13px] text-[var(--rm-fg-2)] ring-1 ring-black/[0.05]">
						<X className="size-3.5 text-rose-600" weight="bold" />
						Deny
					</span>
				</div>
			</div>
		</Stage>
	)
}

export function AuditStage() {
	const events = [
		{ title: "grant.created", meta: "triage-bot · 19:31", tone: "bg-emerald-50", icon: <Check className="size-4 text-emerald-700" weight="bold" /> },
		{ title: "action.executed", meta: "triage-bot · 19:32", tone: "bg-emerald-50", icon: <Check className="size-4 text-emerald-700" weight="bold" /> },
		{ title: "decision.allow", meta: "policy · 19:33", tone: "bg-[rgba(194,73,31,0.09)]", icon: <ShieldCheck className="size-4 text-[var(--rm-accent)]" weight="fill" /> },
	]
	return (
		<Stage>
			<div className="w-full max-w-[420px]">
				<div className="mb-3 flex items-center justify-between px-1">
					<span className="font-mono text-[11px] text-[var(--rm-muted)]">thread th_01J9X7</span>
					<span className="font-mono text-[11px] text-[var(--rm-faint)]">3 events</span>
				</div>
				<div className="space-y-2.5">
					{events.map((event) => (
						<Row
							key={event.title}
							icon={event.icon}
							tone={event.tone}
							title={event.title}
							meta={event.meta}
						/>
					))}
				</div>
			</div>
		</Stage>
	)
}
