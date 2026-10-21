import { ArrowUpRight, Check, Receipt, Robot, User } from "@phosphor-icons/react"
import { container, sectionY } from "./constants"
import { Grain } from "./primitives"

function RequestScene() {
	return (
		<div
			className="relative h-[190px] overflow-hidden border-b border-[var(--rm-line)]"
			style={{ background: "linear-gradient(155deg,#fdf3ea 0%,#f8e3d2 58%,#f2d5c0 100%)" }}
		>
			<span
				aria-hidden="true"
				className="absolute -right-10 -top-12 size-44 rounded-full bg-white/70 blur-2xl"
			/>
			<span
				aria-hidden="true"
				className="absolute -bottom-8 -left-12 size-36 rounded-full bg-white/50 blur-2xl"
			/>

			<div className="absolute left-[32px] top-[24px] h-[132px] w-[272px] rounded-xl bg-white/80 shadow-[0_16px_32px_-20px_rgba(122,64,30,0.55)] ring-1 ring-black/[0.03]" />

			<div className="absolute left-[22px] top-[14px] w-[272px] rounded-xl bg-white p-3.5 shadow-[0_22px_40px_-20px_rgba(122,64,30,0.55)] ring-1 ring-black/[0.04]">
				<div className="flex items-center gap-2">
					<span className="grid size-7 place-items-center rounded-lg bg-[rgba(194,73,31,0.10)]">
						<Robot className="size-4 text-[var(--rm-accent)]" weight="fill" />
					</span>
					<span className="text-[12.5px] font-semibold tracking-[-0.01em] text-[var(--rm-fg)]">
						Request
					</span>
					<span className="ml-auto rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-medium text-amber-700">
						waiting
					</span>
				</div>
				<div className="mt-2.5 text-[16.5px] font-medium leading-5 tracking-[-0.02em] text-[var(--rm-fg)]">
					issues:write
				</div>
				<div className="mt-0.5 font-mono text-[10.5px] text-[var(--rm-faint)]">acme/api · #4821</div>
				<div className="mt-2 flex items-center gap-1.5 border-t border-[#f1e4d8] pt-2">
					<User className="size-3 text-[var(--rm-faint)]" weight="fill" />
					<span className="text-[10.5px] text-[var(--rm-muted)]">dev@helios.dev</span>
				</div>
			</div>

			<div className="absolute right-[18px] top-[146px] flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 shadow-[0_10px_20px_-12px_rgba(122,64,30,0.5)] ring-1 ring-black/[0.04]">
				<span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--rm-accent)]" />
				<span className="text-[10px] font-medium text-[var(--rm-fg-2)]">ttl 10m</span>
			</div>

			<Grain />
		</div>
	)
}

function DecisionScene() {
	const stack = [
		{
			Icon: Check,
			tile: "bg-emerald-100 text-emerald-700",
			label: "Allowed",
			detail: "repo in allowlist",
			pill: "auto",
			pillCls: "bg-emerald-50 text-emerald-700",
		},
		{
			Icon: User,
			tile: "bg-amber-100 text-amber-700",
			label: "Needs consent",
			detail: "write:issues",
			pill: "end user",
			pillCls: "bg-amber-50 text-amber-700",
		},
		{
			Icon: ArrowUpRight,
			tile: "bg-[rgba(194,73,31,0.14)] text-[var(--rm-accent)]",
			label: "Escalated",
			detail: "outside standing grant",
			pill: "human",
			pillCls: "bg-[rgba(194,73,31,0.10)] text-[var(--rm-accent)]",
		},
	]
	return (
		<div
			className="relative h-[190px] overflow-hidden border-b border-[var(--rm-line)]"
			style={{ background: "linear-gradient(160deg,#f1f2fe 0%,#e4e7fb 55%,#d9def8 100%)" }}
		>
			<span
				aria-hidden="true"
				className="absolute -right-8 -top-14 size-44 rounded-full bg-white/60 blur-2xl"
			/>
			<span
				aria-hidden="true"
				className="absolute -bottom-10 left-6 size-32 rounded-full bg-white/40 blur-2xl"
			/>

			{stack
				.map((row, i) => ({ row, i }))
				.reverse()
				.map(({ row, i }) => (
					<div
						className="absolute left-1/2 w-[282px] -translate-x-1/2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-black/[0.04]"
						key={row.label}
						style={{
							top: `${6 + i * 54}px`,
							zIndex: 10 - i,
							boxShadow:
								i === 0
									? "0 20px 38px -18px rgba(58,54,140,0.45)"
									: "0 10px 24px -14px rgba(58,54,140,0.38)",
						}}
					>
						<div className="flex items-center gap-2">
							<span className={`grid size-[26px] place-items-center rounded-lg ${row.tile}`}>
								<row.Icon className="size-3.5" weight="bold" />
							</span>
							<span className="text-[12.5px] font-semibold tracking-[-0.01em] text-[var(--rm-fg)]">
								{row.label}
							</span>
							<span
								className={`ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-medium ${row.pillCls}`}
							>
								{row.pill}
							</span>
						</div>
						<div className="mt-1 pl-8 text-[10.5px] leading-4 text-[var(--rm-muted)]">
							{row.detail}
						</div>
					</div>
				))}

			<Grain />
		</div>
	)
}

function ExecutionScene() {
	return (
		<div
			className="relative h-[190px] overflow-hidden border-b border-[var(--rm-line)]"
			style={{ background: "linear-gradient(150deg,#eef7f0 0%,#dcf0e3 55%,#cfe9d9 100%)" }}
		>
			<span
				aria-hidden="true"
				className="absolute -left-10 -top-12 size-40 rounded-full bg-white/70 blur-2xl"
			/>
			<span
				aria-hidden="true"
				className="absolute -bottom-10 right-0 size-36 rounded-full bg-white/40 blur-2xl"
			/>

			<div className="absolute left-[24px] top-[14px] w-[238px] rounded-xl bg-white p-3.5 shadow-[0_22px_40px_-20px_rgba(20,80,50,0.5)] ring-1 ring-black/[0.04]">
				<div className="flex items-center gap-2">
					<span className="grid size-7 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
						<Check className="size-4" weight="bold" />
					</span>
					<span className="text-[12.5px] font-semibold tracking-[-0.01em] text-[var(--rm-fg)]">
						Executed
					</span>
					<span className="ml-auto font-mono text-[10px] text-[var(--rm-faint)]">412 ms</span>
				</div>
				<div className="mt-2.5 flex items-baseline gap-1.5">
					<span className="text-[18px] font-medium leading-5 tracking-[-0.02em] text-[var(--rm-fg)]">
						200
					</span>
					<span className="font-mono text-[10.5px] text-[var(--rm-faint)]">acme/api</span>
				</div>
				<div className="mt-0.5 text-[10.5px] leading-4 text-[var(--rm-muted)]">
					Retried once · idempotency held
				</div>
			</div>

			<div className="absolute right-[20px] top-[124px] w-[196px] rounded-xl bg-white/95 px-3 py-2.5 shadow-[0_14px_28px_-16px_rgba(20,80,50,0.45)] ring-1 ring-black/[0.04]">
				<div className="flex items-center gap-2">
					<Receipt className="size-3.5 text-[var(--rm-fg-2)]" weight="fill" />
					<span className="text-[11px] font-medium text-[var(--rm-fg)]">Receipt</span>
					<span className="ml-auto font-mono text-[10px] text-[var(--rm-faint)]">#88231</span>
				</div>
			</div>

			<div className="absolute right-[18px] top-[24px] flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 shadow-[0_10px_20px_-12px_rgba(20,80,50,0.5)] ring-1 ring-black/[0.04]">
				<span aria-hidden="true" className="size-1.5 rounded-full bg-amber-400" />
				<span className="text-[10px] font-medium text-[var(--rm-fg-2)]">replay #2</span>
			</div>

			<Grain />
		</div>
	)
}

const steps = [
	{
		index: "01",
		title: "The agent asks",
		copy: "The agent states what it wants to do. Runmesh ties the request to an identity and a task, so nothing arrives anonymous.",
		Scene: RequestScene,
		points: ["Every request carries an agent id", "Scoped to one action and one resource"],
	},
	{
		index: "02",
		title: "Policy decides",
		copy: "Rules evaluate before anything executes. Policy auto-approves by default, the end user consents, a human handles exceptions.",
		Scene: DecisionScene,
		points: ["First-match-wins policy rules", "Consent and escalation built in"],
	},
	{
		index: "03",
		title: "The action runs",
		copy: "Durable execution with retries and idempotency, then a receipt written down: which agent, on whose behalf, approved by whom.",
		Scene: ExecutionScene,
		points: ["Retries and idempotency keys", "One trail: agent → grant → approver → result"],
	},
]

export function HowItWorks() {
	return (
		<section
			id="how-it-works"
			className={`scroll-mt-16 border-t border-[var(--rm-line)] ${sectionY}`}
		>
			<div className={container}>
				<div className="max-w-[720px]">
					<h2 className="text-balance font-display-sans text-[clamp(30px,4.2vw,52px)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--rm-fg)]">
						One request, end to end
					</h2>
					<p className="mt-5 max-w-[560px] text-pretty text-[17px] leading-7 text-[var(--rm-muted)]">
						Nothing to adopt and no sidecar to run. If your agent can make a request, it can act through
						Runmesh.
					</p>
				</div>

				<div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-[var(--rm-line)] bg-[var(--rm-line)] md:grid-cols-3">
					{steps.map(({ Scene, ...item }) => (
						<article className="flex flex-col overflow-hidden bg-[var(--rm-panel)]" key={item.index}>
							<Scene />
							<div className="flex flex-1 flex-col gap-3.5 p-6">
								<span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--rm-accent)]">
									{item.index}
								</span>
								<h3 className="font-display-sans text-[24px] font-medium tracking-[-0.02em] text-[var(--rm-fg)]">
									{item.title}
								</h3>
								<p className="text-[15px] leading-6 text-[var(--rm-muted)]">{item.copy}</p>
								<ul className="mt-auto grid gap-2.5 border-t border-[var(--rm-line)] pt-4">
									{item.points.map((point) => (
										<li
											className="flex gap-2.5 text-[13.5px] leading-5 text-[var(--rm-fg-2)]"
											key={point}
										>
											<span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--rm-accent)]" />
											{point}
										</li>
									))}
								</ul>
							</div>
						</article>
					))}
				</div>
			</div>
		</section>
	)
}
