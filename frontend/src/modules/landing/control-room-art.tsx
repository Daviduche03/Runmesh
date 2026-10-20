import type React from "react"
import { Grain } from "./primitives"

const ACCENT = "#c2491f"

const tints = {
	sand: "linear-gradient(158deg,#fdf5ee 0%,#f8e6d7 52%,#f0d2bc 100%)",
	violet: "linear-gradient(158deg,#f3f4fe 0%,#e6e9fb 52%,#d9def8 100%)",
	mint: "linear-gradient(158deg,#f0f8f2 0%,#ddf0e5 52%,#cde7d7 100%)",
}

function SceneFrame({ tone, children }: { tone: keyof typeof tints; children: React.ReactNode }) {
	return (
		<div
			className="relative overflow-hidden rounded-xl border border-[var(--rm-line)]"
			style={{ background: tints[tone] }}
		>
			<svg viewBox="0 0 720 440" className="block h-auto w-full" role="presentation">
				{children}
			</svg>
			<Grain opacity={0.12} />
		</div>
	)
}

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace"

export function GrantsScene() {
	return (
		<SceneFrame tone="sand">
			<defs>
				<linearGradient id="key-steel" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" stopColor="#eef0f5" />
					<stop offset="46%" stopColor="#ccd0da" />
					<stop offset="100%" stopColor="#a7adba" />
				</linearGradient>
				<linearGradient id="tag-paper" x1="0" y1="0" x2="0.4" y2="1">
					<stop offset="0%" stopColor="#fffdfa" />
					<stop offset="100%" stopColor="#f4ece1" />
				</linearGradient>
				<filter id="g-soft" x="-40%" y="-40%" width="180%" height="180%">
					<feGaussianBlur stdDeviation="9" />
				</filter>
				<filter id="g-cast" x="-60%" y="-60%" width="220%" height="220%">
					<feGaussianBlur stdDeviation="22" />
				</filter>
			</defs>

			<g transform="translate(344 268) rotate(-14)">
				<ellipse rx="146" ry="16" fill="rgba(120,72,38,0.22)" filter="url(#g-soft)" />
			</g>
			<ellipse cx="556" cy="402" rx="92" ry="13" fill="rgba(120,72,38,0.18)" filter="url(#g-soft)" />

			<g transform="translate(296 220) rotate(-14) scale(0.78)">
				<rect x="44" y="-13" width="268" height="26" rx="13" fill="url(#key-steel)" stroke="rgba(24,28,44,0.22)" strokeWidth="1.4" />
				<rect x="250" y="8" width="30" height="48" rx="10" fill="url(#key-steel)" stroke="rgba(24,28,44,0.22)" strokeWidth="1.4" />
				<rect x="290" y="8" width="20" height="34" rx="9" fill="url(#key-steel)" stroke="rgba(24,28,44,0.22)" strokeWidth="1.4" />
				<path
					d="M-57 0a57 57 0 1 0 114 0a57 57 0 1 0 -114 0Z M-25 0a25 25 0 1 0 50 0a25 25 0 1 0 -50 0Z"
					fillRule="evenodd"
					fill="url(#key-steel)"
					stroke="rgba(24,28,44,0.30)"
					strokeWidth="1.6"
				/>
				<rect x="46" y="-21" width="20" height="42" rx="8" fill="#b9bfcb" stroke="rgba(24,28,44,0.22)" strokeWidth="1.4" />
				<path d="M-34 -40a50 50 0 0 1 38 -15" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2.2" strokeLinecap="round" />
			</g>

			<path d="M296 220C338 274 396 312 462 320" fill="none" stroke="#b48a63" strokeWidth="3.2" strokeLinecap="round" />
			<path d="M296 220C338 280 396 318 462 326" fill="none" stroke="#c9a37c" strokeWidth="2.4" strokeLinecap="round" />
			<circle cx="296" cy="220" r="7" fill="url(#key-steel)" stroke="rgba(24,28,44,0.22)" strokeWidth="1.2" />

			<g transform="translate(448 290) rotate(7)">
				<rect x="0" y="0" width="214" height="116" rx="13" fill="url(#tag-paper)" stroke="rgba(70,48,26,0.20)" strokeWidth="1.4" />
				<rect x="0" y="0" width="214" height="116" rx="13" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="1" />
				<circle cx="22" cy="26" r="8" fill="rgba(150,104,64,0.16)" stroke="rgba(70,48,26,0.25)" strokeWidth="1.2" />
				<text x="22" y="66" style={{ fontFamily: mono }} fontSize="18" fontWeight="600" fill="#2b2b33">
					issues:write
				</text>
				<text x="22" y="88" style={{ fontFamily: mono }} fontSize="12.5" fill="rgba(43,43,51,0.66)">
					acme/api
				</text>
				<text x="22" y="105" style={{ fontFamily: mono }} fontSize="11" fill="rgba(43,43,51,0.5)">
					expires in 9m
				</text>
				<circle cx="186" cy="94" r="3.6" fill={ACCENT} opacity="0.85" />
			</g>

			<Grain opacity={0.1} />
		</SceneFrame>
	)
}

export function PoliciesScene() {
	return (
		<SceneFrame tone="violet">
			<defs>
				<linearGradient id="housing" x1="0" y1="0" x2="1" y2="0">
					<stop offset="0%" stopColor="#43434d" />
					<stop offset="30%" stopColor="#2c2c34" />
					<stop offset="100%" stopColor="#131318" />
				</linearGradient>
				<linearGradient id="pole" x1="0" y1="0" x2="1" y2="0">
					<stop offset="0%" stopColor="#4a4a55" />
					<stop offset="60%" stopColor="#26262d" />
					<stop offset="100%" stopColor="#15151a" />
				</linearGradient>
				<radialGradient id="lens-green" cx="0.36" cy="0.3" r="0.8">
					<stop offset="0%" stopColor="#c6ffdd" />
					<stop offset="45%" stopColor="#3ee08a" />
					<stop offset="100%" stopColor="#128a4c" />
				</radialGradient>
				<radialGradient id="lens-amber" cx="0.36" cy="0.3" r="0.8">
					<stop offset="0%" stopColor="#6b5320" />
					<stop offset="100%" stopColor="#3a2c10" />
				</radialGradient>
				<radialGradient id="lens-red" cx="0.36" cy="0.3" r="0.8">
					<stop offset="0%" stopColor="#6d2a22" />
					<stop offset="100%" stopColor="#391512" />
				</radialGradient>
				<filter id="p-glow" x="-90%" y="-90%" width="280%" height="280%">
					<feGaussianBlur stdDeviation="14" />
				</filter>
				<filter id="p-cast" x="-60%" y="-60%" width="220%" height="220%">
					<feGaussianBlur stdDeviation="18" />
				</filter>
			</defs>

			<ellipse cx="360" cy="420" rx="150" ry="26" fill="rgba(46,44,96,0.24)" filter="url(#p-cast)" />

			<rect x="342" y="358" width="36" height="62" fill="url(#pole)" />
			<rect x="306" y="412" width="108" height="12" rx="6" fill="#1d1d24" />

			<rect x="264" y="42" width="192" height="330" rx="36" fill="url(#housing)" stroke="rgba(8,8,12,0.5)" strokeWidth="2" />
			<rect x="272" y="50" width="176" height="314" rx="30" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1.4" />

			<circle cx="360" cy="120" r="48" fill="#0b0b0f" />
			<circle cx="360" cy="120" r="40" fill="url(#lens-red)" />
			<ellipse cx="346" cy="106" rx="18" ry="12" fill="rgba(255,255,255,0.16)" />

			<circle cx="360" cy="212" r="48" fill="#0b0b0f" />
			<circle cx="360" cy="212" r="40" fill="url(#lens-amber)" />
			<ellipse cx="346" cy="198" rx="18" ry="12" fill="rgba(255,255,255,0.14)" />

			<circle cx="360" cy="304" r="48" fill="#0b0b0f" />
			<circle cx="360" cy="304" r="42" fill="#4dff9d" opacity="0.35" filter="url(#p-glow)" />
			<circle cx="360" cy="304" r="40" fill="url(#lens-green)" />
			<ellipse cx="345" cy="288" rx="19" ry="12" fill="rgba(255,255,255,0.55)" />

			<path d="M276 74v266" stroke="rgba(255,255,255,0.14)" strokeWidth="4" strokeLinecap="round" />

			<Grain opacity={0.1} />
		</SceneFrame>
	)
}

export function AuditScene() {
	const rows = [
		["19:31", "triage-bot", "grant.created"],
		["19:32", "triage-bot", "action.executed"],
		["19:33", "policy", "decision.allow"],
		["19:34", "repo-watch", "grant.revoked"],
	]
	return (
		<SceneFrame tone="mint">
			<defs>
				<linearGradient id="paper" x1="0" y1="0" x2="0.2" y2="1">
					<stop offset="0%" stopColor="#fffefb" />
					<stop offset="70%" stopColor="#fbf7f0" />
					<stop offset="100%" stopColor="#f0e9de" />
				</linearGradient>
				<filter id="a-cast" x="-60%" y="-60%" width="220%" height="220%">
					<feGaussianBlur stdDeviation="16" />
				</filter>
			</defs>

			<ellipse cx="356" cy="392" rx="170" ry="30" fill="rgba(24,72,48,0.24)" filter="url(#a-cast)" />

			<g transform="translate(340 216) rotate(-3)">
				<path
					d="M-146 -162h292v300l-14.6 18l-14.6 -18l-14.6 18l-14.6 -18l-14.6 18l-14.6 -18l-14.6 18l-14.6 -18l-14.6 18l-14.6 -18l-14.6 18l-14.6 -18l-14.6 18l-14.6 -18l-14.6 18l-14.6 -18l-14.6 18l-14.6 -18l-14.6 18l-14.6 -18l-14.6 18l-14.6 -18Z"
					fill="url(#paper)"
					stroke="rgba(40,50,44,0.16)"
					strokeWidth="1.4"
					strokeLinejoin="round"
				/>

				<text x="-118" y="-128" style={{ fontFamily: mono }} fontSize="13" fontWeight="600" fill="#2b2b33">
					thread th_01J9X7
				</text>
				<text x="86" y="-128" style={{ fontFamily: mono }} fontSize="12" fill="rgba(43,43,51,0.45)">
					4 events
				</text>
				<path d="M-118 -114h236" stroke="rgba(43,43,51,0.16)" strokeWidth="1" strokeDasharray="3 4" />

				{rows.map(([time, actor, action], i) => (
					<g key={action}>
						<text x="-118" y={-88 + i * 34} style={{ fontFamily: mono }} fontSize="12.5" fill="rgba(43,43,51,0.45)">
							{time}
						</text>
						<text x="-72" y={-88 + i * 34} style={{ fontFamily: mono }} fontSize="12.5" fontWeight="600" fill="#2b2b33">
							{actor}
						</text>
						<text x="-72" y={-72 + i * 34} style={{ fontFamily: mono }} fontSize="11.5" fill="rgba(43,43,51,0.55)">
							{action}
						</text>
					</g>
				))}

				<path d="M-118 64h236" stroke="rgba(43,43,51,0.16)" strokeWidth="1" strokeDasharray="3 4" />
				<text x="-118" y="90" style={{ fontFamily: mono }} fontSize="12" fill="rgba(43,43,51,0.5)">
					agent → grant → approver → result
				</text>

				<g transform="translate(90 -8) rotate(-12)">
					<circle r="44" fill="none" stroke="#b2382a" strokeWidth="3.2" />
					<circle r="36" fill="none" stroke="#b2382a" strokeWidth="1.1" />
					<path d="M-12 0l8 9l16 -18" fill="none" stroke="#b2382a" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
					<text
						x="0"
						y="26"
						textAnchor="middle"
						fontSize="8.5"
						letterSpacing="1.4"
						fill="#b2382a"
						style={{ fontFamily: mono }}
					>
						RECORDED
					</text>
				</g>
			</g>

			<Grain opacity={0.1} />
		</SceneFrame>
	)
}
