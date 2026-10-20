import type React from "react"
import { Grain } from "./primitives"

const ACCENT = "#c2491f"
const INK = "rgba(10,14,25,0.5)"
const INK_SOFT = "rgba(10,14,25,0.16)"

const tints = {
	sand: "linear-gradient(160deg,#fdf4ec 0%,#f8e4d4 55%,#f1d3bd 100%)",
	violet: "linear-gradient(160deg,#f2f3fe 0%,#e5e8fb 55%,#dadef9 100%)",
	mint: "linear-gradient(160deg,#eff8f1 0%,#dcf0e4 55%,#cee8d8 100%)",
}

const OX = 360
const OY = 250
const K = 0.866
const HALF = 0.5

function pt(x: number, y: number, z = 0): [number, number] {
	return [OX + (x - y) * K, OY + (x + y) * HALF - z]
}

function face(points: Array<[number, number, number]>) {
	return points.map(([x, y, z]) => pt(x, y, z).map((n) => n.toFixed(1)).join(",")).join(" ")
}

function Defs({ id }: { id: string }) {
	return (
		<defs>
			<linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
				<stop offset="0%" stopColor="#e8865c" />
				<stop offset="55%" stopColor={ACCENT} />
				<stop offset="100%" stopColor="#9c3a17" />
			</linearGradient>
			<filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%">
				<feGaussianBlur stdDeviation="5" />
			</filter>
			<filter id={`${id}-glow`} x="-80%" y="-80%" width="260%" height="260%">
				<feGaussianBlur stdDeviation="10" />
			</filter>
			<filter id={`${id}-blur`} x="-60%" y="-60%" width="220%" height="220%">
				<feGaussianBlur stdDeviation="16" />
			</filter>
		</defs>
	)
}

function Backdrop({ id }: { id: string }) {
	return (
		<g>
			<ellipse cx={OX} cy={OY} rx="252" ry="150" fill="rgba(255,255,255,0.55)" filter={`url(#${id}-glow)`} />
			<ellipse
				cx={OX}
				cy={OY}
				rx="308"
				ry="172"
				fill="none"
				stroke="rgba(10,14,25,0.07)"
				strokeWidth="1"
				strokeDasharray="2 10"
			/>
			<ellipse cx={OX} cy={OY + 56} rx="214" ry="80" fill="rgba(10,14,25,0.07)" filter={`url(#${id}-blur)`} />
		</g>
	)
}

function Sparkles() {
	const dots: Array<[number, number, number, number]> = [
		[196, 302, 3, 0.22],
		[524, 150, 2.6, 0.2],
		[304, 116, 2.2, 0.16],
		[478, 334, 3.2, 0.18],
		[176, 178, 2.2, 0.14],
		[556, 262, 2.6, 0.16],
	]
	return (
		<g fill="rgba(10,14,25,0.55)">
			{dots.map(([cx, cy, r, o]) => (
				<circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} opacity={o} />
			))}
		</g>
	)
}

function Platform({ size = 168 }: { size?: number }) {
	const lip = 13
	return (
		<g>
			<polygon
				points={face([
					[-size, size, -lip],
					[size, size, -lip],
					[size, size, 0],
					[-size, size, 0],
				])}
				fill="rgba(10,14,25,0.07)"
			/>
			<polygon
				points={face([
					[size, size, -lip],
					[size, -size, -lip],
					[size, -size, 0],
					[size, size, 0],
				])}
				fill="rgba(10,14,25,0.045)"
			/>
			<polygon
				points={face([
					[-size, -size, 0],
					[size, -size, 0],
					[size, size, 0],
					[-size, size, 0],
				])}
				fill="rgba(255,255,255,0.68)"
				stroke={INK_SOFT}
				strokeWidth="1.2"
			/>
			<polygon
				points={face([
					[-size + 28, -size + 28, 0],
					[size - 28, -size + 28, 0],
					[size - 28, size - 28, 0],
					[-size + 28, size - 28, 0],
				])}
				fill="none"
				stroke="rgba(10,14,25,0.07)"
				strokeWidth="1"
				strokeDasharray="3 7"
			/>
		</g>
	)
}

function Cube({
	x,
	y,
	size = 46,
	height = 46,
	filter,
}: {
	x: number
	y: number
	size?: number
	height?: number
	filter: string
}) {
	const h = size / 2
	const ground = pt(x, y, 0)
	return (
		<g>
			<ellipse
				cx={ground[0]}
				cy={ground[1] + 4}
				rx={size * 0.85}
				ry={size * 0.4}
				fill="rgba(10,14,25,0.10)"
				filter={filter}
			/>
			<polygon
				points={face([
					[x - h, y + h, height],
					[x + h, y + h, height],
					[x + h, y + h, 0],
					[x - h, y + h, 0],
				])}
				fill="rgba(255,255,255,0.97)"
				stroke={INK}
				strokeWidth="1.2"
				strokeLinejoin="round"
			/>
			<polygon
				points={face([
					[x + h, y + h, height],
					[x + h, y - h, height],
					[x + h, y - h, 0],
					[x + h, y + h, 0],
				])}
				fill="rgba(255,255,255,0.93)"
				stroke={INK}
				strokeWidth="1.2"
				strokeLinejoin="round"
			/>
			<polygon
				points={face([
					[x - h, y - h, height],
					[x + h, y - h, height],
					[x + h, y + h, height],
					[x - h, y + h, height],
				])}
				fill="rgba(255,255,255,0.98)"
				stroke={INK}
				strokeWidth="1.2"
				strokeLinejoin="round"
			/>
		</g>
	)
}

function Slab({
	x,
	y,
	z = 0,
	w = 136,
	d = 100,
	thickness = 9,
	filter,
}: {
	x: number
	y: number
	z?: number
	w?: number
	d?: number
	thickness?: number
	filter: string
}) {
	const hw = w / 2
	const hd = d / 2
	const base = pt(x, y, 0)
	return (
		<g>
			{z === 0 && (
				<ellipse
					cx={base[0]}
					cy={base[1] + 6}
					rx={w * 0.72}
					ry={d * 0.4}
					fill="rgba(10,14,25,0.10)"
					filter={filter}
				/>
			)}
			<polygon
				points={face([
					[x - hw, y + hd, z],
					[x + hw, y + hd, z],
					[x + hw, y + hd, z + thickness],
					[x - hw, y + hd, z + thickness],
				])}
				fill="rgba(255,255,255,0.95)"
				stroke={INK}
				strokeWidth="1.1"
			/>
			<polygon
				points={face([
					[x + hw, y + hd, z],
					[x + hw, y - hd, z],
					[x + hw, y - hd, z + thickness],
					[x + hw, y + hd, z + thickness],
				])}
				fill="rgba(255,255,255,0.9)"
				stroke={INK}
				strokeWidth="1.1"
			/>
			<polygon
				points={face([
					[x - hw, y - hd, z + thickness],
					[x + hw, y - hd, z + thickness],
					[x + hw, y + hd, z + thickness],
					[x - hw, y + hd, z + thickness],
				])}
				fill="rgba(255,255,255,0.99)"
				stroke={INK}
				strokeWidth="1.1"
			/>
		</g>
	)
}

function Gate({ id, x, y, r = 56, lift = 66 }: { id: string; x: number; y: number; r?: number; lift?: number }) {
	const c = pt(x, y, lift)
	return (
		<g>
			<circle cx={c[0]} cy={c[1]} r={r} fill="none" stroke={ACCENT} strokeWidth="16" opacity="0.22" filter={`url(#${id}-glow)`} />
			<circle cx={c[0]} cy={c[1]} r={r} fill="none" stroke={`url(#${id}-ring)`} strokeWidth="7.5" strokeLinecap="round" />
			<circle cx={c[0]} cy={c[1]} r={r - 8} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" />
			<circle cx={c[0]} cy={c[1]} r={r + 11} fill="none" stroke="rgba(194,73,31,0.25)" strokeWidth="1" strokeDasharray="2 8" />
		</g>
	)
}

function Key({ x, y, rotate = -18 }: { x: number; y: number; rotate?: number }) {
	return (
		<g transform={`translate(${x} ${y}) rotate(${rotate})`}>
			<circle r="20" fill={ACCENT} opacity="0.14" style={{ filter: "blur(7px)" }} />
			<circle r="16" fill="rgba(255,255,255,0.98)" stroke={ACCENT} strokeWidth="3.8" />
			<path d="M16 0h38" stroke={ACCENT} strokeWidth="3.8" strokeLinecap="round" />
			<path d="M43 0v13M52 0v8" stroke={ACCENT} strokeWidth="3.8" strokeLinecap="round" />
		</g>
	)
}

function Marker({
	cx,
	cy,
	tone,
	children,
}: {
	cx: number
	cy: number
	tone: string
	children: React.ReactNode
}) {
	return (
		<g>
			<circle cx={cx} cy={cy} r="21" fill="rgba(255,255,255,0.99)" stroke={tone} strokeWidth="2" />
			{children}
		</g>
	)
}

function SceneFrame({ tone, children }: { tone: keyof typeof tints; children: React.ReactNode }) {
	return (
		<div className="relative overflow-hidden rounded-xl border border-[var(--rm-line)]" style={{ background: tints[tone] }}>
			<svg viewBox="0 0 720 440" className="block h-auto w-full" role="presentation">
				{children}
			</svg>
			<Grain opacity={0.13} />
		</div>
	)
}

export function GrantsScene() {
	const id = "grants"
	const soft = `url(#${id}-soft)`
	return (
		<SceneFrame tone="sand">
			<Defs id={id} />
			<Backdrop id={id} />
			<Platform />
			<path
				d="M286 200 C 318 196, 346 188, 370 184 C 404 180, 442 214, 486 254"
				fill="none"
				stroke={ACCENT}
				strokeWidth="1.6"
				strokeDasharray="5 7"
				strokeLinecap="round"
			/>
			<Cube x={-104} y={30} size={56} height={56} filter={soft} />
			<Cube x={106} y={-50} size={40} height={40} filter={soft} />
			<Gate id={id} x={6} y={-6} />
			<Key x={492} y={108} />
			<Sparkles />
		</SceneFrame>
	)
}

export function PoliciesScene() {
	const id = "policies"
	const soft = `url(#${id}-soft)`
	return (
		<SceneFrame tone="violet">
			<Defs id={id} />
			<Backdrop id={id} />
			<Platform />
			<path
				d="M360 188 C 330 194, 286 214, 240 236"
				fill="none"
				stroke="rgba(16,122,72,0.6)"
				strokeWidth="1.7"
				strokeDasharray="5 7"
				strokeLinecap="round"
			/>
			<path
				d="M360 188 C 400 174, 444 170, 484 174"
				fill="none"
				stroke="rgba(178,118,8,0.6)"
				strokeWidth="1.7"
				strokeDasharray="5 7"
				strokeLinecap="round"
			/>
			<path
				d="M360 188 C 398 214, 452 258, 496 288"
				fill="none"
				stroke="rgba(194,73,31,0.6)"
				strokeWidth="1.7"
				strokeDasharray="5 7"
				strokeLinecap="round"
			/>
			<Cube x={0} y={0} size={46} height={60} filter={soft} />
			<Marker cx={240} cy={236} tone="rgba(16,122,72,0.65)">
				<path d="M232 236l5.5 5.5 10-11" fill="none" stroke="rgba(16,122,72,0.95)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
			</Marker>
			<Marker cx={484} cy={174} tone="rgba(178,118,8,0.65)">
				<path d="M477 174h14" stroke="rgba(178,118,8,0.95)" strokeWidth="2.6" strokeLinecap="round" />
			</Marker>
			<Marker cx={496} cy={288} tone="rgba(194,73,31,0.7)">
				<path d="M489 281l14 14M503 281l-14 14" stroke={ACCENT} strokeWidth="2.4" strokeLinecap="round" />
			</Marker>
			<circle cx="360" cy="184" r="6.5" fill={ACCENT} />
			<circle cx="360" cy="184" r="13" fill={ACCENT} opacity="0.18" filter={`url(#${id}-soft)`} />
			<Sparkles />
		</SceneFrame>
	)
}

export function AuditScene() {
	const id = "audit"
	const soft = `url(#${id}-soft)`
	return (
		<SceneFrame tone="mint">
			<Defs id={id} />
			<Backdrop id={id} />
			<Platform />
			<path
				d="M142 344 C 200 328, 260 300, 320 264"
				fill="none"
				stroke={ACCENT}
				strokeWidth="1.6"
				strokeDasharray="5 7"
				strokeLinecap="round"
			/>
			<g fill={ACCENT}>
				<circle cx="166" cy="334" r="2.6" opacity="0.35" />
				<circle cx="196" cy="320" r="3" opacity="0.5" />
				<circle cx="226" cy="305" r="3.3" opacity="0.68" />
				<circle cx="258" cy="292" r="3.6" opacity="0.85" />
				<circle cx="292" cy="278" r="3.9" opacity="1" />
			</g>
			<Slab x={-6} y={-6} z={0} thickness={9} filter={soft} />
			<Slab x={0} y={0} z={13} thickness={9} filter={soft} />
			<Slab x={6} y={6} z={26} thickness={9} filter={soft} />
			<g>
				<circle cx="360" cy="150" r="23" fill="rgba(255,255,255,0.97)" stroke={ACCENT} strokeWidth="2.2" />
				<path d="M350 150l7 7 12-13" fill="none" stroke={ACCENT} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
				<path d="M360 173v20" stroke="rgba(194,73,31,0.32)" strokeWidth="1.2" strokeDasharray="3 5" />
			</g>
			<Sparkles />
		</SceneFrame>
	)
}
