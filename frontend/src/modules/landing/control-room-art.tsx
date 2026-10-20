import type React from "react"
import { Grain } from "./primitives"

const ACCENT = "#c2491f"
const INK = "#242a36"
const MUTED = "rgba(36,42,54,0.52)"
const mono = "ui-monospace, SFMono-Regular, Menlo, monospace"

const tints = {
	sand: "linear-gradient(158deg,#fdf6ef 0%,#f9e9da 55%,#f3d9c6 100%)",
	violet: "linear-gradient(158deg,#f4f5fe 0%,#e8ebfb 55%,#dce0f8 100%)",
	mint: "linear-gradient(158deg,#f1f9f3 0%,#e0f1e7 55%,#d0e8da 100%)",
}

function Sheet({
	id,
	tone,
	fig,
	caption,
	children,
}: {
	id: string
	tone: keyof typeof tints
	fig: string
	caption: string
	children: React.ReactNode
}) {
	return (
		<div
			className="relative overflow-hidden rounded-xl border border-[var(--rm-line)]"
			style={{ background: tints[tone] }}
		>
			<svg viewBox="0 0 720 440" className="block h-auto w-full" role="presentation">
				<defs>
					<pattern id={`grid-${id}`} width="24" height="24" patternUnits="userSpaceOnUse">
						<path d="M24 0H0V24" fill="none" stroke="rgba(36,42,54,0.045)" strokeWidth="1" />
					</pattern>
				</defs>
				<rect width="720" height="440" fill={`url(#grid-${id})`} />

				<g fill="none" stroke="rgba(36,42,54,0.18)" strokeWidth="1">
					<path d="M24 34v-10h10M696 34v-10h-10M24 396v10h10M696 396v10h-10" />
				</g>

				{children}

				<path d="M44 402h632" stroke="rgba(36,42,54,0.16)" strokeWidth="1" />
				<text x="44" y="422" style={{ fontFamily: mono }} fontSize="9" letterSpacing="1.6" fill={MUTED}>
					{fig.toUpperCase()} — {caption.toUpperCase()}
				</text>
				<text x="676" y="422" textAnchor="end" style={{ fontFamily: mono }} fontSize="9" letterSpacing="1.6" fill={MUTED}>
					RUNMESH / CONTROL PLANE
				</text>
			</svg>
			<Grain opacity={0.1} />
		</div>
	)
}

function Arrow({
	id,
	x1,
	y1,
	x2,
	y2,
	accent,
	dashed,
}: {
	id: string
	x1: number
	y1: number
	x2: number
	y2: number
	accent?: boolean
	dashed?: boolean
}) {
	return (
		<line
			x1={x1}
			y1={y1}
			x2={x2}
			y2={y2}
			stroke={accent ? ACCENT : "rgba(36,42,54,0.45)"}
			strokeWidth="1.2"
			strokeDasharray={dashed ? "4 4" : undefined}
			markerEnd={`url(#${id}-head${accent ? "-accent" : ""})`}
		/>
	)
}

function Heads({ id }: { id: string }) {
	return (
		<defs>
			<marker id={`${id}-head`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
				<path d="M0 0L10 5L0 10Z" fill="rgba(36,42,54,0.5)" />
			</marker>
			<marker id={`${id}-head-accent`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
				<path d="M0 0L10 5L0 10Z" fill={ACCENT} />
			</marker>
		</defs>
	)
}

function Node({
	x,
	y,
	w = 132,
	h = 64,
	label,
	value,
	accent,
}: {
	x: number
	y: number
	w?: number
	h?: number
	label: string
	value: string
	accent?: boolean
}) {
	return (
		<g>
			<rect
				x={x}
				y={y}
				width={w}
				height={h}
				rx="6"
				fill="rgba(255,255,255,0.92)"
				stroke={accent ? ACCENT : "rgba(36,42,54,0.42)"}
				strokeWidth={accent ? 1.4 : 1.1}
			/>
			<text x={x + 13} y={y + 21} style={{ fontFamily: mono }} fontSize="8.5" letterSpacing="1.4" fill={accent ? ACCENT : MUTED}>
				{label.toUpperCase()}
			</text>
			<text x={x + 13} y={y + 45} style={{ fontFamily: mono }} fontSize="12.5" fill={INK}>
				{value}
			</text>
		</g>
	)
}

export function GrantsScene() {
	const id = "g1"
	const nodes = [
		{ x: 44, label: "agent", value: "triage-bot" },
		{ x: 208, label: "request", value: "issues:write" },
		{ x: 372, label: "policy", value: "escalate", accent: true },
		{ x: 556, label: "grant", value: "9m · 5 uses" },
	]
	const y = 176
	return (
		<Sheet id="g1" tone="sand" fig="fig. 01" caption="grant issuance">
			<Heads id={id} />

			<text x="44" y="86" style={{ fontFamily: mono }} fontSize="9" letterSpacing="1.6" fill={MUTED}>
				ONE REQUEST · ONE CAPABILITY
			</text>
			<path d="M44 98h632" stroke="rgba(36,42,54,0.14)" strokeWidth="1" />

			{nodes.map((node) => (
				<Node key={node.label} x={node.x} y={y} label={node.label} value={node.value} accent={node.accent} />
			))}

			<Arrow id={id} x1={176} y1={y + 32} x2={206} y2={y + 32} />
			<Arrow id={id} x1={340} y1={y + 32} x2={370} y2={y + 32} />
			<Arrow id={id} x1={504} y1={y + 32} x2={552} y2={y + 32} accent />
			<text x="528" y={y + 24} textAnchor="middle" style={{ fontFamily: mono }} fontSize="8.5" fill={ACCENT}>
				consent
			</text>

			<Arrow id={id} x1={438} y1={176} x2={438} y2={128} accent dashed />
			<text x="452" y="126" style={{ fontFamily: mono }} fontSize="11" fill={ACCENT}>
				deny → 403
			</text>

			<path d="M274 240v22" stroke="rgba(36,42,54,0.32)" strokeWidth="1" />
			<text x="274" y="276" textAnchor="middle" style={{ fontFamily: mono }} fontSize="10.5" fill={MUTED}>
				resource · acme/api
			</text>

			<path d="M622 240v22" stroke="rgba(36,42,54,0.32)" strokeWidth="1" />
			<text x="622" y="276" textAnchor="middle" style={{ fontFamily: mono }} fontSize="10.5" fill={MUTED}>
				on behalf of dev@helios.dev
			</text>

			<path d="M44 322h632" stroke="rgba(36,42,54,0.14)" strokeWidth="1" strokeDasharray="2 6" />
			<text x="44" y="348" style={{ fontFamily: mono }} fontSize="10" fill={MUTED}>
				no durable secret · the capability dies on its own
			</text>
		</Sheet>
	)
}

const rules = [
	{ index: "01", match: "repo ∈ allowlist", outcome: "allow", actor: "policy" },
	{ index: "02", match: "write:* → prod", outcome: "consent", actor: "end user" },
	{ index: "03", match: "outside standing grant", outcome: "escalate", actor: "operator", hit: true },
	{ index: "04", match: "*", outcome: "deny", actor: "blocked" },
]

export function PoliciesScene() {
	return (
		<Sheet id="p1" tone="violet" fig="fig. 02" caption="policy evaluation">
			<text x="44" y="78" style={{ fontFamily: mono }} fontSize="9" letterSpacing="1.6" fill={MUTED}>
				EVALUATED IN ORDER · FIRST MATCH WINS
			</text>
			<path d="M44 90h632" stroke="rgba(36,42,54,0.14)" strokeWidth="1" />

			<text x="44" y="112" style={{ fontFamily: mono }} fontSize="8.5" letterSpacing="1.4" fill="rgba(36,42,54,0.4)">
				RULE
			</text>
			<text x="404" y="112" style={{ fontFamily: mono }} fontSize="8.5" letterSpacing="1.4" fill="rgba(36,42,54,0.4)">
				RESOLUTION
			</text>
			<text x="556" y="112" style={{ fontFamily: mono }} fontSize="8.5" letterSpacing="1.4" fill="rgba(36,42,54,0.4)">
				ACTOR
			</text>

			{rules.map((rule, i) => {
				const top = 126 + i * 62
				return (
					<g key={rule.index}>
						{rule.hit && (
							<rect
								x="36"
								y={top - 10}
								width="648"
								height="56"
								rx="6"
								fill="rgba(194,73,31,0.06)"
								stroke={ACCENT}
								strokeWidth="1.2"
							/>
						)}
						<text x="48" y={top + 24} style={{ fontFamily: mono }} fontSize="10" fill={rule.hit ? ACCENT : "rgba(36,42,54,0.4)"}>
							{rule.index}
						</text>
						<text
							x="84"
							y={top + 24}
							style={{ fontFamily: mono }}
							fontSize="12.5"
							fill={rule.hit ? INK : "rgba(36,42,54,0.55)"}
						>
							{rule.match}
						</text>
						<path
							d={`M306 ${top + 20}h84`}
							stroke="rgba(36,42,54,0.22)"
							strokeWidth="1"
							strokeDasharray="2 4"
						/>
						<text
							x="404"
							y={top + 25}
							style={{ fontFamily: mono }}
							fontSize="12.5"
							fontWeight={rule.hit ? 600 : 400}
							fill={rule.hit ? ACCENT : INK}
						>
							{rule.outcome}
						</text>
						<text x="556" y={top + 25} style={{ fontFamily: mono }} fontSize="11.5" fill={rule.hit ? "rgba(36,42,54,0.8)" : MUTED}>
							{rule.actor}
						</text>
						{i < rules.length - 1 && (
							<path d={`M44 ${top + 44}h624`} stroke="rgba(36,42,54,0.12)" strokeWidth="1" />
						)}
					</g>
				)
			})}

			<path d="M44 372h632" stroke="rgba(36,42,54,0.14)" strokeWidth="1" />
			<text x="44" y="388" style={{ fontFamily: mono }} fontSize="10" fill={MUTED}>
				unmatched falls to default deny · log-only rules record but never decide
			</text>
		</Sheet>
	)
}

const events = [
	{ x: 132, time: "19:31", title: "grant.created", actor: "triage-bot" },
	{ x: 300, time: "19:32", title: "action.executed", actor: "triage-bot" },
	{ x: 468, time: "19:33", title: "decision.allow", actor: "policy", accent: true },
	{ x: 612, time: "19:34", title: "grant.revoked", actor: "repo-watch" },
]

export function AuditScene() {
	const id = "a1"
	const axisY = 268
	return (
		<Sheet id="a1" tone="mint" fig="fig. 03" caption="audit trail">
			<Heads id={id} />

			<text x="44" y="86" style={{ fontFamily: mono }} fontSize="9" letterSpacing="1.6" fill={MUTED}>
				ONE THREAD · EVERY EVENT ATTRIBUTED
			</text>

			<path d="M132 118h480" stroke="rgba(36,42,54,0.35)" strokeWidth="1" />
			<path d="M132 112v12M612 112v12" stroke="rgba(36,42,54,0.35)" strokeWidth="1" />
			<text x="372" y="106" textAnchor="middle" style={{ fontFamily: mono }} fontSize="10.5" fill={INK}>
				thread th_01J9X7
			</text>

			{events.map((event) => (
				<g key={event.time}>
					<path d={`M${event.x} 196v${axisY - 196}`} stroke="rgba(36,42,54,0.22)" strokeWidth="1" strokeDasharray="2 4" />
					<text
						x={event.x}
						y="182"
						textAnchor="middle"
						style={{ fontFamily: mono }}
						fontSize="12"
						fontWeight={event.accent ? 600 : 400}
						fill={event.accent ? ACCENT : INK}
					>
						{event.title}
					</text>
					<text x={event.x} y="164" textAnchor="middle" style={{ fontFamily: mono }} fontSize="10" fill={MUTED}>
						{event.actor}
					</text>
					<circle cx={event.x} cy={axisY} r="4.5" fill={event.accent ? ACCENT : INK} />
					<circle cx={event.x} cy={axisY} r="9" fill="none" stroke={event.accent ? "rgba(194,73,31,0.4)" : "rgba(36,42,54,0.2)"} strokeWidth="1" />
					<text x={event.x} y={axisY + 30} textAnchor="middle" style={{ fontFamily: mono }} fontSize="10.5" fill="rgba(36,42,54,0.45)">
						{event.time}
					</text>
				</g>
			))}

			<path d={`M64 ${axisY}h572`} stroke="rgba(36,42,54,0.4)" strokeWidth="1.2" />
			<Arrow id={id} x1={636} y1={axisY} x2={668} y2={axisY} />

			<path d="M44 340h632" stroke="rgba(36,42,54,0.14)" strokeWidth="1" strokeDasharray="2 6" />
			<text x="44" y="364" style={{ fontFamily: mono }} fontSize="10" fill={MUTED}>
				agent → grant → approver → result
			</text>
			<text x="676" y="364" textAnchor="end" style={{ fontFamily: mono }} fontSize="10" fill={MUTED}>
				export · replay
			</text>
		</Sheet>
	)
}
