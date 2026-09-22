/**
 * HeroGraphic — an extruded top-down ("2.5D") view of the Runmesh station.
 *
 * The metaphor: the station IS Runmesh. Trains are agent actions circulating
 * the loop (the execution path). Every lap crosses three gantries — Identity
 * → Access → Control — and a signal that only clears once the request is
 * authorized. The express runs the outer loop straight through; the local
 * runs the inner loop, is held at a red signal, then released. People on the
 * platforms are the users agents act for; buildings are the services around.
 *
 * Volume comes from a shared `Box` helper (shadow + side + top). Motion is
 * CSS/SMIL; the animated trains are hidden and parked static copies shown
 * under `prefers-reduced-motion`. Palette is the brand tokens.
 */
const KEYFRAMES = `
.hs-signal-local { animation: hs-signal-local 30s steps(1,end) infinite; }
.hs-signal-express { animation: hs-signal-express 30s steps(1,end) infinite; }
.hs-glow { animation: hs-glow 3.6s ease-in-out infinite; }

@keyframes hs-signal-local { 0%, 19% { fill: #e5484d; } 20%, 100% { fill: #46a758; } }
@keyframes hs-signal-express { 0%, 100% { fill: #46a758; } }
@keyframes hs-glow { 0%, 100% { opacity: .75; } 50% { opacity: 1; } }

.hs-static { display: none; }
@media (prefers-reduced-motion: reduce) {
  .hs-motion { display: none; }
  .hs-static { display: inline; }
  .hs-signal-local { animation: none !important; fill: #46a758; }
  .hs-glow { animation: none !important; }
}
`;

const LOOP_EXPRESS =
	"M 470 210 H 1130 A 210 210 0 0 1 1340 420 V 480 A 210 210 0 0 1 1130 690 H 470 A 210 210 0 0 1 260 480 V 420 A 210 210 0 0 1 470 210 Z";
const LOOP_LOCAL =
	"M 630 320 H 970 A 130 130 0 0 1 1100 450 V 450 A 130 130 0 0 1 970 580 H 630 A 130 130 0 0 1 500 450 V 450 A 130 130 0 0 1 630 320 Z";

const GROUND = "#0a0a0b";
const LAND = "#0e0f11";
const ROAD = "#121216";
const LINE = "#1c1d20";
const LINE_2 = "#2a2b2f";
const TOP_FACE = "#1a1c20";
const SIDE_FACE = "#0f1013";
const ACCENT = "#e1683c";
const MUTED = "#9a9ca1";

function Box({
	x,
	y,
	w,
	h,
	depth = 8,
	radius = 4,
	top = TOP_FACE,
	side = SIDE_FACE,
	shadow = true,
}: {
	x: number;
	y: number;
	w: number;
	h: number;
	depth?: number;
	radius?: number;
	top?: string;
	side?: string;
	shadow?: boolean;
}) {
	return (
		<g>
			{shadow ? <rect x={x + 6} y={y + depth + 6} width={w} height={h} rx={radius} fill="#000000" opacity="0.35" /> : null}
			<rect x={x} y={y + depth} width={w} height={h} rx={radius} fill={side} />
			<rect x={x} y={y} width={w} height={h + depth} rx={radius} fill={side} opacity="0" />
			<rect x={x} y={y} width={w} height={h} rx={radius} fill={top} />
			<rect x={x} y={y} width={w} height={h} rx={radius} fill="none" stroke={LINE_2} strokeWidth="1.2" />
		</g>
	);
}

type TrainPalette = { body: string; roof: string; accent: string; window: string };

function TrainUnit({ kind, body, roof, accent, window: win }: { kind: "nose" | "car" } & TrainPalette) {
	const len = kind === "nose" ? 64 : 100;
	const half = len / 2;
	const H = 18;
	const roofW = kind === "nose" ? len - 6 : len;
	const flanks = kind === "nose" ? [8] : [14, 42, 70];

	return (
		<g>
			{/* ground shadow */}
			<rect x={-half + 5} y={H + 8} width={len} height={14} rx={7} fill="#000000" opacity="0.45" />
			{/* visible flank (near side of the box) */}
			<rect x={-half} y={-2} width={len} height={H + 6} rx={kind === "nose" ? 22 : 7} fill={body} />
			<rect x={-half} y={-2} width={len} height="3" fill="#000000" opacity="0.3" />
			<rect x={-half} y={H + 1} width={len} height="3" fill="#000000" opacity="0.4" />
			{flanks.map((wx) => (
				<rect key={wx} x={-half + wx} y={4} width="13" height="9" rx="2" fill={win} opacity="0.9" />
			))}
			<rect x={-half} y={H - 1} width={len} height="3" fill={accent} opacity="0.95" />
			{/* roof (top face), lifted so the flank shows */}
			<rect x={-half} y={-2 - H} width={roofW} height={20} rx={kind === "nose" ? 12 : 7} fill={roof} />
			<rect x={-half} y={-2 - H} width={roofW} height={20} rx={kind === "nose" ? 12 : 7} fill="none" stroke={LINE_2} strokeWidth="1" />
			{kind === "car" ? (
				<line x1={-half + 10} y1={7 - H} x2={half - 10} y2={7 - H} stroke={LINE} strokeWidth="1.3" opacity="0.55" />
			) : null}
			{kind === "car"
				? [26, 54, 82].map((vx) => (
						<rect key={vx} x={-half + vx} y={2 - H} width="3" height="9" rx="1" fill={LINE} opacity="0.5" />
					))
				: null}
			<rect x={-half + 5} y={16 - H} width={roofW - 10} height="1.5" fill="#ffffff" opacity="0.16" />
			{/* headlight on the nose */}
			{kind === "nose" ? (
				<>
					<circle cx={half - 4} cy={H / 2} r="20" fill={ACCENT} opacity="0.14" className="hs-glow" />
					<circle cx={half - 8} cy={H / 2} r="4.5" fill="#fff4e8" />
				</>
			) : null}
		</g>
	);
}

/**
 * Articulated train: every car is its own `animateMotion` along the same loop,
 * phase-offset by its distance from the head. That way the cars follow the
 * curve (couple/uncouple) instead of rotating as one rigid body — which is
 * what made the old version leave the rails.
 */
function Train({ loopId, dur, lapLen, body, roof, accent, window: win }: { loopId: string; dur: number; lapLen: number } & TrainPalette) {
	const carLen = 100;
	const gap = 12;
	const noseLen = 64;
	const dists: number[] = [0];
	let prevLen = noseLen;
	let d = 0;
	for (let i = 0; i < 3; i++) {
		d += prevLen / 2 + gap + carLen / 2;
		dists.push(d);
		prevLen = carLen;
	}
	return (
		<>
			{dists.map((dist, i) => {
				const begin = (dist / lapLen) * dur - dur;
				return (
					<g key={i}>
						<animateMotion begin={`${begin}s`} dur={`${dur}s`} repeatCount="indefinite" rotate="auto">
							<mpath href={`#${loopId}`} />
						</animateMotion>
						<TrainUnit kind={i === 0 ? "nose" : "car"} body={body} roof={roof} accent={accent} window={win} />
					</g>
				);
			})}
		</>
	);
}

function Person({ x, y, coat = "#1d2126", hat = false }: { x: number; y: number; coat?: string; hat?: boolean }) {
	return (
		<g transform={`translate(${x} ${y})`}>
			<ellipse cx="3" cy="8" rx="9" ry="4" fill="#000000" opacity="0.4" />
			<rect x="-5" y="-3" width="10" height="12" rx="5" fill={coat} />
			<circle cx="0" cy="-5" r="5.2" fill="#c9a98a" />
			{hat ? <path d="M -6 -7.5 a 6 6 0 0 1 12 0 z" fill="#0b0f14" /> : null}
		</g>
	);
}

export function HeroGraphic() {
	const housesTop = [
		[40, 40, 96, 74], [156, 30, 74, 92], [250, 52, 110, 66], [382, 34, 80, 84], [482, 46, 96, 72],
		[600, 30, 70, 96], [690, 52, 108, 68], [820, 36, 76, 88], [916, 48, 100, 70], [1036, 32, 72, 94],
		[1128, 52, 112, 66], [1262, 36, 78, 86], [1360, 48, 98, 72], [1480, 30, 84, 96],
	];
	const housesBottom = [
		[40, 780, 96, 76], [156, 800, 74, 66], [250, 772, 110, 88], [382, 802, 80, 62],
		[482, 776, 96, 82], [600, 800, 70, 64], [1100, 778, 100, 84], [1224, 802, 74, 62],
		[1320, 774, 108, 88], [1450, 802, 80, 64],
	];
	const trees = [
		[140, 150], [230, 128], [330, 158], [440, 132], [560, 152], [660, 128], [770, 158], [880, 132],
		[990, 152], [1090, 128], [1200, 158], [1310, 132], [1420, 152], [1520, 128],
		[150, 748], [300, 750], [440, 752], [560, 748], [1000, 750], [1180, 748], [1290, 752], [1440, 748],
	];

	return (
		<svg
			viewBox="0 0 1600 900"
			role="img"
			aria-label="Extruded top-down illustration of the Runmesh loop station: trains circulating the rails through the Identity, Access, and Control gantries, held and released by signals."
			className="block w-full rounded-xl"
		>
			<style>{KEYFRAMES}</style>

			<defs>
				<radialGradient id="hs-lamp" cx="50%" cy="50%" r="50%">
					<stop offset="0%" stopColor={ACCENT} stopOpacity="0.35" />
					<stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
				</radialGradient>
				<radialGradient id="hs-vignette" cx="50%" cy="50%" r="72%">
					<stop offset="58%" stopColor="#000000" stopOpacity="0" />
					<stop offset="100%" stopColor="#000000" stopOpacity="0.45" />
				</radialGradient>
				<path id="hs-loop-express" d={LOOP_EXPRESS} />
				<path id="hs-loop-local" d={LOOP_LOCAL} />
			</defs>

			{/* ── ground ────────────────────────────────────────── */}
			<rect x="0" y="0" width="1600" height="900" fill={GROUND} />
			<rect x="0" y="0" width="1600" height="180" fill={LAND} />
			<rect x="0" y="760" width="1600" height="140" fill={LAND} />
			<rect x="0" y="180" width="230" height="580" fill={LAND} />
			<rect x="1370" y="180" width="230" height="580" fill={LAND} />

			{/* roads */}
			<rect x="0" y="104" width="1600" height="30" fill={ROAD} />
			<line x1="0" y1="119" x2="1600" y2="119" stroke={LINE_2} strokeWidth="1.6" strokeDasharray="20 16" />
			<rect x="0" y="812" width="1600" height="30" fill={ROAD} />
			<line x1="0" y1="827" x2="1600" y2="827" stroke={LINE_2} strokeWidth="1.6" strokeDasharray="20 16" />
			<rect x="96" y="134" width="30" height="646" fill={ROAD} />
			<rect x="1474" y="134" width="30" height="646" fill={ROAD} />

			{/* ── town (extruded boxes) ─────────────────────────── */}
			{[...housesTop, ...housesBottom].map(([x, y, w, h], i) => (
				<g key={i}>
					<Box x={x} y={y} w={w} h={h} depth={12} radius={3} top={TOP_FACE} side={SIDE_FACE} />
					<line x1={x + 8} y1={y + h / 2} x2={x + w - 8} y2={y + h / 2} stroke={LINE_2} strokeWidth="1.4" />
					{Array.from({ length: 3 }).map((_, w2) => (
						<rect
							key={w2}
							x={x + 12 + w2 * ((w - 28) / 3)}
							y={y + 12}
							width="10"
							height="10"
							rx="2"
							fill={w2 % 2 === 0 ? ACCENT : LINE}
							opacity={w2 % 2 === 0 ? 0.7 : 1}
						/>
					))}
				</g>
			))}

			{/* trees (extruded circles) */}
			{trees.map(([x, y], i) => (
				<g key={i}>
					<ellipse cx={x + 4} cy={y + 8} rx="12" ry="9" fill="#000000" opacity="0.35" />
					<circle cx={x} cy={y + 4} r="12" fill="#111a15" />
					<circle cx={x} cy={y} r="12" fill="#15241c" stroke={LINE_2} strokeWidth="1" />
					<circle cx={x - 3} cy={y - 3} r="4" fill="#1b2e23" opacity="0.8" />
				</g>
			))}

			{/* parking */}
			<g>
				<rect x="600" y="848" width="240" height="52" rx="6" fill="#101114" stroke={LINE} strokeWidth="1.4" />
				{[0, 1, 2, 3].map((i) => (
					<g key={i}>
						<rect x={612 + i * 58} y={866} width="42" height="22" rx="5" fill={i % 2 === 0 ? LINE_2 : SIDE_FACE} />
						<rect x={618 + i * 58} y={872} width="30" height="12" rx="3" fill={LINE} />
					</g>
				))}
			</g>

			{/* ── rail loops ────────────────────────────────────── */}
			{[LOOP_EXPRESS, LOOP_LOCAL].map((d, i) => (
				<g key={i}>
					<path d={d} fill="none" stroke={SIDE_FACE} strokeWidth="42" strokeLinejoin="round" />
					<path d={d} fill="none" stroke="#101114" strokeWidth="34" strokeLinejoin="round" />
					<path d={d} fill="none" stroke={LINE_2} strokeWidth="26" strokeLinejoin="round" strokeDasharray="3 11" />
					<path d={d} fill="none" stroke="#4a4c51" strokeWidth="1.6" strokeLinejoin="round" />
				</g>
			))}

			{/* ── platforms (between the loops) ─────────────────── */}
			<Box x={470} y={300} w={660} h={44} depth={10} radius={6} top="#1d2024" side={SIDE_FACE} />
			<Box x={470} y={536} w={660} h={44} depth={10} radius={6} top="#1d2024" side={SIDE_FACE} />
			{/* safety stripe + tactile */}
			<rect x="480" y="304" width="640" height="3" fill={ACCENT} opacity="0.75" />
			<rect x="480" y="336" width="640" height="3" fill={ACCENT} opacity="0.75" />
			<rect x="480" y="540" width="640" height="3" fill={ACCENT} opacity="0.75" />
			<rect x="480" y="572" width="640" height="3" fill={ACCENT} opacity="0.75" />

			{/* ── central island + station house ────────────────── */}
			<Box x={540} y={372} w={520} h={120} depth={14} radius={8} top="#141619" side={SIDE_FACE} />
			<Box x={640} y={392} w={320} h={82} depth={18} radius={6} top={TOP_FACE} side="#0c0d10" />
			<rect x="660" y="412" width="130" height="42" rx="4" fill="#24272c" />
			<rect x="810" y="412" width="130" height="42" rx="4" fill="#24272c" />
			<line x1="800" y1="392" x2="800" y2="474" stroke={LINE_2} strokeWidth="2" />
			<circle cx="800" cy="433" r="15" fill={LINE} />
			<circle cx="800" cy="433" r="11" fill={MUTED} className="hs-glow" />
			{/* entrance canopy */}
			<Box x={600} y={500} w={400} h={26} depth={8} radius={5} top="#26292e" side={SIDE_FACE} />

			{/* ── moving trains (articulated: each car follows the loop) ── */}
			<g className="hs-motion">
				<Train loopId="hs-loop-express" dur={30} lapLen={2760} body="#2f333a" roof="#3b4048" accent={ACCENT} window="#0e1014" />
				<Train loopId="hs-loop-local" dur={34} lapLen={1497} body="#d9dbdf" roof="#eff0f2" accent="#c2491f" window="#0e1014" />
			</g>
			{/* parked copies for reduced motion */}
			<g className="hs-static">
				<g transform="translate(700 210)">
					<TrainUnit kind="nose" body="#2f333a" roof="#3b4048" accent={ACCENT} window="#0e1014" />
					<g transform="translate(112 0)"><TrainUnit kind="car" body="#2f333a" roof="#3b4048" accent={ACCENT} window="#0e1014" /></g>
					<g transform="translate(224 0)"><TrainUnit kind="car" body="#2f333a" roof="#3b4048" accent={ACCENT} window="#0e1014" /></g>
				</g>
				<g transform="translate(1128 450) rotate(90)">
					<TrainUnit kind="nose" body="#d9dbdf" roof="#eff0f2" accent="#c2491f" window="#0e1014" />
					<g transform="translate(112 0)"><TrainUnit kind="car" body="#d9dbdf" roof="#eff0f2" accent="#c2491f" window="#0e1014" /></g>
					<g transform="translate(224 0)"><TrainUnit kind="car" body="#d9dbdf" roof="#eff0f2" accent="#c2491f" window="#0e1014" /></g>
				</g>
			</g>

			{/* ── signals ───────────────────────────────────────── */}
			<g>
				<circle cx="1128" cy="450" r="6" fill="#0b0f14" stroke={LINE_2} strokeWidth="1.6" />
				<circle cx="1128" cy="450" r="3.4" className="hs-signal-local" />
				<circle cx="1372" cy="450" r="6" fill="#0b0f14" stroke={LINE_2} strokeWidth="1.6" />
				<circle cx="1372" cy="450" r="3.4" className="hs-signal-express" />
			</g>

			{/* ── people on the platforms ───────────────────────── */}
			<Person x={560} y={330} coat="#22262c" hat />
			<Person x={600} y={328} coat="#3a3f46" />
			<Person x={980} y={332} coat="#2b3037" />
			<Person x={860} y={566} coat="#22262c" />
			<Person x={900} y={570} coat="#3a3f46" hat />
			<Person x={620} y={568} coat="#2b3037" />
			<g className="hs-motion">
				<Person x={700} y={566} coat={ACCENT} />
				<Person x={1040} y={330} coat="#4a5057" hat />
			</g>

			{/* ── the three gates (extruded gantries) ───────────── */}
			{[
				{ x: 520, label: "IDENTITY" },
				{ x: 800, label: "ACCESS" },
				{ x: 1080, label: "CONTROL" },
			].map((gate) => (
				<g key={gate.label}>
					{/* span */}
					<rect x={gate.x + 4} y="182" width="16" height="520" rx="4" fill="#000000" opacity="0.3" />
					<rect x={gate.x - 6} y="172" width="16" height="520" rx="4" fill={LINE_2} />
					<rect x={gate.x - 6} y="172" width="6" height="520" rx="3" fill="#3a3d42" />
					{/* pylons */}
					{[182, 682].map((y) => (
						<g key={y}>
							<rect x={gate.x - 11} y={y - 2} width="26" height="14" rx="3" fill="#000000" opacity="0.35" />
							<rect x={gate.x - 13} y={y - 8} width="26" height="14" rx="3" fill={TOP_FACE} stroke={LINE_2} strokeWidth="1.2" />
						</g>
					))}
					{/* label */}
					<rect x={gate.x - 66} y="128" width="132" height="30" rx="5" fill="#0c0d10" stroke={LINE_2} strokeWidth="1.4" />
					<circle cx={gate.x - 48} cy="143" r="5" fill={ACCENT} />
					<text
						x={gate.x + 8}
						y="148"
						textAnchor="middle"
						fontSize="13"
						letterSpacing="2.4"
						fill="#e6e7e9"
						fontFamily="'IBM Plex Mono', ui-monospace, monospace"
						fontWeight="600"
					>
						{gate.label}
					</text>
				</g>
			))}

			{/* foreground vignette */}
			<rect x="0" y="0" width="1600" height="900" fill="url(#hs-vignette)" />
		</svg>
	);
}
