import { Check, Cube, Database } from "@phosphor-icons/react"
import { Grain } from "./primitives"

function TerminalCard() {
	return (
		<div className="relative z-10 w-full rounded-xl bg-[#0e1117] p-4 shadow-[0_34px_56px_-32px_rgba(12,30,24,0.85)] ring-1 ring-black/25">
			<div className="flex items-center gap-1.5 pb-3.5">
				<span className="size-2 rounded-full bg-white/20" />
				<span className="size-2 rounded-full bg-white/20" />
				<span className="size-2 rounded-full bg-white/20" />
				<span className="ml-2 font-mono text-[10.5px] text-white/40">compose.yaml</span>
			</div>
			<div className="space-y-2 font-mono text-[12px] leading-4">
				<div className="text-white/90">
					<span className="text-white/35">$ </span>docker compose up -d
				</div>
				<div className="flex items-center gap-2 text-white/65">
					<Check className="size-3.5 shrink-0 text-emerald-400" weight="bold" />
					migrations applied
				</div>
				<div className="flex items-center gap-2 text-white/65">
					<Check className="size-3.5 shrink-0 text-emerald-400" weight="bold" />
					api on :8787
				</div>
				<div className="flex items-center gap-2 text-white/65">
					<Check className="size-3.5 shrink-0 text-emerald-400" weight="bold" />
					scheduler sweep every 5s
				</div>
			</div>
		</div>
	)
}

function HostCard() {
	return (
		<div className="relative w-full rounded-xl bg-white p-4 shadow-[0_26px_44px_-26px_rgba(16,60,45,0.5)] ring-1 ring-black/[0.05]">
			<div className="flex items-center gap-2">
				<span className="grid size-7 place-items-center rounded-lg bg-[rgba(194,73,31,0.10)]">
					<Cube className="size-4 text-[var(--rm-accent)]" weight="fill" />
				</span>
				<span className="text-[13.5px] font-semibold tracking-[-0.01em] text-[var(--rm-fg)]">runmesh</span>
				<span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700">
					<span className="size-1.5 rounded-full bg-emerald-500" />
					running
				</span>
			</div>
			<div className="mt-3 flex items-center gap-2 border-t border-[var(--rm-line)] pt-3">
				<Database className="size-3.5 shrink-0 text-[var(--rm-muted)]" weight="fill" />
				<span className="text-[12px] text-[var(--rm-fg-2)]">runmesh.db</span>
				<span className="ml-auto font-mono text-[11px] text-[var(--rm-faint)]">2.4 MB</span>
			</div>
		</div>
	)
}

export function SelfHostScene() {
	return (
		<div
			className="relative flex min-h-[430px] lg:min-h-[470px] items-center justify-center overflow-hidden rounded-2xl border border-[var(--rm-line)] p-8 lg:p-10"
			style={{ background: "linear-gradient(155deg,#eef6f1 0%,#def0e7 52%,#cbe4d8 100%)" }}
		>
			<span
				aria-hidden="true"
				className="absolute -left-16 -top-24 size-64 rounded-full bg-white/70 blur-3xl"
			/>
			<span
				aria-hidden="true"
				className="absolute -bottom-28 -right-16 size-72 rounded-full bg-white/45 blur-3xl"
			/>

			<div className="relative flex w-full max-w-[400px] flex-col gap-3.5">
				<div className="w-[92%]">
					<TerminalCard />
				</div>
				<div className="relative z-20 -mt-2 w-[72%] self-end">
					<HostCard />
				</div>
			</div>

			<span className="absolute right-6 top-6 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[10.5px] font-medium text-[var(--rm-fg-2)] shadow-[0_10px_20px_-14px_rgba(16,60,45,0.6)] ring-1 ring-black/[0.04]">
				<span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--rm-accent)]" />
				MIT licensed
			</span>

			<Grain opacity={0.1} />
		</div>
	)
}
