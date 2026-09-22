import { cn } from "@/lib/utils";

/**
 * ProductShot — an in-repo, brand-matched mock of a Runmesh surface.
 *
 * Every variant shares one 1200×750 viewBox, so all landing imagery has an
 * identical aspect ratio (and therefore consistent width/height in layout)
 * while showing the *current* product direction: control room, agents,
 * grants, approvals, actions, audit, policies, connect.
 */
export type ProductShotVariant =
	| "control-room"
	| "agents"
	| "grants"
	| "approvals"
	| "actions"
	| "audit"
	| "policies"
	| "connect"
	| "terminal"
	| "sync"
	| "encrypt";

const C = {
	bg: "#0b0c0d",
	panel: "#0e0f11",
	panel2: "#131417",
	line: "#1c1d20",
	line2: "#2a2b2f",
	fg: "#f4f2ee",
	muted: "#9a9ca1",
	faint: "#5f6166",
	accent: "#e1683c",
	success: "#46a758",
	danger: "#e5484d",
	warn: "#d9a441",
	sky: "#5b9bf0",
	violet: "#8b7bd8",
};

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<>
			<rect x="0" y="0" width="1200" height="750" rx="16" fill={C.bg} />
			<rect x="0.5" y="0.5" width="1199" height="749" rx="16" fill="none" stroke={C.line} />
			<rect x="0" y="0" width="1200" height="46" rx="16" fill={C.panel} />
			<rect x="0" y="30" width="1200" height="16" fill={C.panel} />
			<line x1="0" y1="46" x2="1200" y2="46" stroke={C.line} />
			<circle cx="26" cy="23" r="5" fill={C.line2} />
			<circle cx="46" cy="23" r="5" fill={C.line2} />
			<circle cx="66" cy="23" r="5" fill={C.line2} />
			<rect x="150" y="15" width="200" height="16" rx="4" fill={C.panel2} />
			<text
				x="164"
				y="27"
				fontSize="10"
				letterSpacing="1.5"
				fill={C.muted}
				fontFamily="'IBM Plex Mono', ui-monospace, monospace"
			>
				{label}
			</text>
			{children}
		</>
	);
}

const t = (x: number, y: number, s: string, fill = C.muted, size = 10) => (
	<text x={x} y={y} fontSize={size} letterSpacing="1.4" fill={fill} fontFamily="'IBM Plex Mono', ui-monospace, monospace">
		{s}
	</text>
);

function Panel({ x, y, w, h, title }: { x: number; y: number; w: number; h: number; title: string }) {
	return (
		<>
			<rect x={x} y={y} width={w} height={h} rx="10" fill={C.panel} stroke={C.line} />
			{t(x + 18, y + 26, title, C.muted)}
		</>
	);
}

function Dot({ x, y, fill }: { x: number; y: number; fill: string }) {
	return <circle cx={x} cy={y} r="4" fill={fill} />;
}

export function ProductShot({ variant, className }: { variant: ProductShotVariant; className?: string }) {
	const body: Record<ProductShotVariant, React.ReactNode> = {
		"control-room": (
			<>
				{[0, 1, 2, 3].map((i) => {
					const x = 32 + i * 288;
					return (
						<g key={i}>
							<rect x={x} y={76} width={272} height={104} rx="10" fill={C.panel} stroke={C.line} />
							<rect x={x + 16} y={94} width={72} height={8} rx="2" fill={C.line2} />
							<rect x={x + 16} y={116} width={92} height={22} rx="3" fill={C.fg} opacity="0.85" />
							<rect x={x} y={148} width={272} height={32} fill={C.panel2} />
							<rect x={x + 16} y={160} width={60} height={8} rx="2" fill={C.line2} />
							<rect x={x + 84} y={160} width={40} height={8} rx="2" fill={i === 1 ? C.accent : C.line2} />
						</g>
					);
				})}
				<Panel x={32} y={200} w={704} h={296} title="ACTION THROUGHPUT" />
				{[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => {
					const h = 40 + Math.round(90 * Math.abs(Math.sin(i * 0.8)));
					return <rect key={i} x={62 + i * 55} y={446 - h} width={30} height={h} rx="3" fill={C.accent} opacity="0.55" />;
				})}
				<line x1="52" y1="452" x2="712" y2="452" stroke={C.line} />
				<Panel x={752} y={200} w={416} h={296} title="ACTION OUTCOMES" />
				<circle cx="960" cy="348" r="76" fill="none" stroke={C.line2} strokeWidth="26" />
				<circle
					cx="960"
					cy="348"
					r="76"
					fill="none"
					stroke={C.success}
					strokeWidth="26"
					strokeDasharray="392 478"
					transform="rotate(-90 960 348)"
				/>
				{t(960, 352, "82%", C.fg, 22)}
				<rect x={792} y={444} width={10} height={10} rx="2" fill={C.success} />
				<rect x={812} y={446} width={70} height={7} rx="2" fill={C.line2} />
				<rect x={910} y={444} width={10} height={10} rx="2" fill={C.warn} />
				<rect x={930} y={446} width={70} height={7} rx="2" fill={C.line2} />
				<Panel x={32} y={520} w={1136} h={198} title="RECENT AUDIT" />
				{["14:02", "13:58", "13:57", "13:51"].map((time, i) => {
					const y = 562 + i * 36;
					return (
						<g key={time}>
							<rect x={52} y={y} width={44} height={8} rx="2" fill={C.line2} />
							{t(52, y + 6, time, C.faint)}
							<rect x={180} y={y} width={90} height={8} rx="2" fill={C.muted} opacity="0.5" />
							<rect x={300} y={y} width={150} height={8} rx="2" fill={C.line2} />
							<rect x={470} y={y} width={120} height={8} rx="2" fill={C.line2} />
							<Dot x={1120} y={y + 4} fill={i === 1 ? C.danger : C.success} />
						</g>
					);
				})}
			</>
		),
		agents: (
			<>
				{Array.from({ length: 6 }).map((_, i) => {
					const x = 32 + (i % 3) * 388;
					const y = 92 + Math.floor(i / 3) * 300;
					const status = [C.success, C.faint, C.warn, C.danger, C.success, C.faint][i];
					return (
						<g key={i}>
							<rect x={x} y={y} width={356} height={268} rx="12" fill={C.panel} stroke={C.line} />
							<circle cx={x + 52} cy={y + 60} r="26" fill={C.panel2} stroke={C.line2} />
							<circle cx={x + 52} cy={y + 60} r="10" fill={C.muted} opacity="0.6" />
							<rect x={x + 98} y={y + 44} width={110} height={12} rx="3" fill={C.fg} opacity="0.8" />
							<rect x={x + 98} y={y + 66} width={70} height={9} rx="2" fill={C.line2} />
							<rect x={x + 286} y={y + 40} width={54} height={16} rx="8" fill={C.panel2} stroke={C.line} />
							<Dot x={x + 298} y={y + 48} fill={status} />
							<rect x={x + 24} y={y + 120} width={220} height={10} rx="2" fill={C.line2} />
							<rect x={x + 24} y={y + 142} width={160} height={10} rx="2" fill={C.line2} />
							<rect x={x} y={y + 234} width={356} height={34} fill={C.panel2} />
							<rect x={x + 24} y={y + 246} width={140} height={10} rx="2" fill={C.line2} />
						</g>
					);
				})}
			</>
		),
		grants: (
			<>
				<Panel x={32} y={76} w={1136} h={642} title="GRANTS" />
				<rect x={52} y={120} width={1096} height={30} fill={C.panel2} />
				{["USER", "SCOPE", "RESOURCE", "EXPIRY", "USES", "STATUS"].map((h, i) => (
					<g key={h}>{t(72 + i * 182, 140, h, C.faint)}</g>
				))}
				{Array.from({ length: 7 }).map((_, i) => {
					const y = 168 + i * 68;
					const status = [C.success, C.success, C.success, C.warn, C.faint, C.danger, C.success][i];
					return (
						<g key={i}>
							<line x1={52} y1={y + 52} x2={1148} y2={y + 52} stroke={C.line} />
							<rect x={72} y={y} width={120} height={9} rx="2" fill={C.muted} opacity="0.55" />
							<rect x={254} y={y} width={130} height={9} rx="2" fill={C.line2} />
							<rect x={436} y={y} width={110} height={9} rx="2" fill={C.line2} />
							<rect x={618} y={y} width={70} height={9} rx="2" fill={C.line2} />
							<rect x={800} y={y} width={48} height={9} rx="2" fill={C.line2} />
							<Dot x={990} y={y + 4} fill={status} />
						</g>
					);
				})}
			</>
		),
		approvals: (
			<>
				<Panel x={32} y={76} w={760} h={642} title="WAITING ON YOU" />
				{Array.from({ length: 4 }).map((_, i) => {
					const y = 126 + i * 118;
					return (
						<g key={i}>
							<rect x={52} y={y} width={720} height={98} rx="8" fill={C.panel2} stroke={C.line} />
							<rect x={72} y={y + 20} width={90} height={11} rx="3" fill={C.fg} opacity="0.8" />
							<rect x={72} y={y + 44} width={220} height={9} rx="2" fill={C.line2} />
							<rect x={72} y={y + 66} width={150} height={14} rx="7" fill={C.warn} opacity="0.2" />
							<rect x={82} y={y + 70} width={90} height={6} rx="2" fill={C.warn} opacity="0.7" />
							<rect x={560} y={y + 60} width={90} height={22} rx="4" fill={C.accent} />
							<rect x={660} y={y + 60} width={90} height={22} rx="4" fill="none" stroke={C.line2} />
						</g>
					);
				})}
				<Panel x={812} y={76} w={356} h={642} title="ACTIVE POLICY" />
				{[
					["auto", C.success],
					["consent", C.sky],
					["escalate", C.warn],
					["block", C.danger],
				].map(([label, color], i) => (
					<g key={label as string}>
						<rect x={834} y={126 + i * 64} width={12} height={12} rx="3" fill={color as string} />
						{t(856, 136 + i * 64, (label as string).toUpperCase(), color as string)}
						<rect x={834} y={150 + i * 64} width={300} height={9} rx="2" fill={C.line2} />
						<rect x={834} y={166 + i * 64} width={220} height={9} rx="2" fill={C.line2} opacity="0.6" />
					</g>
				))}
			</>
		),
		actions: (
			<>
				<Panel x={32} y={76} w={1136} h={642} title="RUNS" />
				<rect x={52} y={120} width={1096} height={30} fill={C.panel2} />
				{Array.from({ length: 8 }).map((_, i) => {
					const y = 168 + i * 66;
					const status = [C.success, C.success, C.warn, C.danger, C.success, C.success, C.faint, C.success][i];
					const w = [40, 90, 30, 60, 120, 70, 20, 100][i];
					return (
						<g key={i}>
							<line x1={52} y1={y + 50} x2={1148} y2={y + 50} stroke={C.line} />
							<rect x={72} y={y} width={70} height={9} rx="2" fill={C.muted} opacity="0.5" />
							<rect x={180} y={y} width={240} height={9} rx="2" fill={C.line2} />
							<Dot x={470} y={y + 4} fill={status} />
							<rect x={490} y={y} width={70} height={9} rx="2" fill={status} opacity="0.7" />
							<rect x={600} y={y + 1} width={w * 3} height={7} rx="2" fill={C.line2} />
							<rect x={1040} y={y} width={40} height={9} rx="2" fill={C.line2} />
						</g>
					);
				})}
			</>
		),
		audit: (
			<>
				<Panel x={32} y={76} w={1136} h={642} title="AUDIT — THREAD" />
				<line x1="100" y1="140" x2="100" y2="690" stroke={C.line2} />
				{[
					{ y: 160, run: true, c: C.success },
					{ y: 258, run: false, c: C.success },
					{ y: 330, run: false, c: C.success },
					{ y: 432, run: true, c: C.danger },
					{ y: 530, run: false, c: C.warn },
					{ y: 602, run: false, c: C.danger },
				].map((n, i) => (
					<g key={i}>
						<circle cx="100" cy={n.y} r={n.run ? 10 : 6} fill={C.panel} stroke={n.c} strokeWidth="2" />
						<circle cx="100" cy={n.y} r={n.run ? 4 : 2.5} fill={n.c} />
						<rect x={126} y={n.y - 7} width={n.run ? 200 : 150} height={n.run ? 14 : 10} rx="3" fill={n.run ? C.fg : C.line2} opacity={n.run ? 0.8 : 1} />
						<rect x={n.run ? 360 : 300} y={n.y - 5} width={90} height={9} rx="2" fill={C.line2} />
						<rect x={470} y={n.y - 5} width={120} height={9} rx="2" fill={C.line2} opacity="0.7" />
						<circle cx="1120" cy={n.y} r="4" fill={n.c} />
					</g>
				))}
				<line x1="220" y1="140" x2="220" y2="690" stroke={C.line} />
			</>
		),
		policies: (
			<>
				<Panel x={32} y={76} w={1136} h={642} title="POLICIES — IN ORDER" />
				<rect x={52} y={120} width={1096} height={86} rx="8" fill={C.panel2} stroke={C.line} />
				{t(76, 150, "DEFAULT", C.faint)}
				{t(76, 178, "deny", C.danger, 16)}
				<rect x={200} y={140} width={420} height={12} rx="3" fill={C.line2} />
				{Array.from({ length: 5 }).map((_, i) => {
					const y = 226 + i * 96;
					const color = [C.success, C.warn, C.sky, C.danger, C.success][i];
					return (
						<g key={i}>
							<rect x={52} y={y} width={1096} height={80} rx="8" fill={C.panel} stroke={C.line} />
							{t(76, y + 32, `#${i + 1}`, C.faint)}
							<rect x={126} y={y + 20} width={200} height={11} rx="3" fill={C.fg} opacity="0.8" />
							<rect x={126} y={y + 44} width={360} height={9} rx="2" fill={C.line2} />
							<rect x={980} y={y + 28} width={140} height={22} rx="11" fill={color} opacity="0.18" />
							<rect x={994} y={y + 35} width={80} height={8} rx="2" fill={color} opacity="0.85" />
						</g>
					);
				})}
			</>
		),
		connect: (
			<>
				<Panel x={32} y={76} w={1136} h={642} title="CONNECT — PROVIDERS" />
				<rect x={52} y={120} width={1096} height={30} fill={C.panel2} />
				{["APP", "SLUGS", "AUTH", "MANAGEMENT", "LAST UPDATED"].map((h, i) => (
					<g key={h}>{t([72, 300, 500, 720, 950][i], 140, h, C.faint)}</g>
				))}
				{Array.from({ length: 6 }).map((_, i) => {
					const y = 168 + i * 86;
					const badges = [1, 0, 2, 1, 3, 2][i];
					return (
						<g key={i}>
							<line x1={52} y1={y + 70} x2={1148} y2={y + 70} stroke={C.line} />
							<rect x={72} y={y} width={30} height={30} rx="7" fill={C.panel2} stroke={C.line2} />
							<circle cx={87} cy={y + 15} r="8" fill={C.muted} opacity="0.5" />
							<rect x={116} y={y + 10} width={90} height={10} rx="3" fill={C.fg} opacity="0.75" />
							<rect x={300} y={y + 11} width={70} height={9} rx="2" fill={C.line2} />
							<rect x={384} y={y + 11} width={54} height={9} rx="2" fill={C.line2} opacity="0.6" />
							{[0, 1, 2].slice(0, badges).map((b) => (
								<rect
									key={b}
									x={500 + b * 66}
									y={y + 8}
									width={58}
									height={15}
									rx="7"
									fill="none"
									stroke={[C.muted, C.success, C.sky][b]}
									opacity="0.7"
								/>
							))}
							<circle cx={1060} cy={y + 15} r="11" fill="none" stroke={C.line2} />
							<circle cx={1088} cy={y + 15} r="11" fill="none" stroke={C.line2} />
						</g>
					);
				})}
			</>
		),
		terminal: (
			<>
				<rect x={32} y={76} width={1136} height={642} rx="10" fill="#0a0b0c" stroke={C.line} />
				<line x1={32} y1="112" x2="1168" y2="112" stroke={C.line} />
				{t(52, 101, "~/code/acme — runmesh", C.faint)}
				{(
					[
						["$", "runmesh link acme", C.accent],
						["✓", "linked  ~/code/acme → bucket/acme", C.success],
						["$", "runmesh up", C.accent],
						["↑", "synced  128 files · 3.4 MB", C.success],
						["·", ".devignore  excluded node_modules, .git, dist", C.faint],
						["$", "runmesh watch", C.accent],
						["●", "watching  local ⇄ r2://bucket/acme", C.warn],
					] as [string, string, string][]
				).map(([mark, line, markColor], i) => (
					<g key={i}>
						<text
							x="52"
							y={166 + i * 38}
							fontSize="13"
							fill={markColor}
							fontFamily="'IBM Plex Mono', ui-monospace, monospace"
						>
							{mark}
						</text>
						<text
							x="84"
							y={166 + i * 38}
							fontSize="13"
							fill={markColor === C.accent ? C.fg : C.muted}
							fontFamily="'IBM Plex Mono', ui-monospace, monospace"
						>
							{line}
						</text>
					</g>
				))}
				<rect x="52" y={166 + 6 * 38 + 8} width="140" height="14" rx="2" fill={C.accent} opacity="0.3" />
				<rect x="52" y={166 + 7 * 38 - 12} width="220" height="0" />
			</>
		),
		sync: (
			<>
				<Panel x={32} y={76} w={1136} h={642} title="SYNC — LOCAL ⇄ CLOUD" />
				{t(72, 128, "LOCAL", C.faint)}
				{t(980, 128, "R2://BUCKET/ACME", C.faint)}
				{Array.from({ length: 8 }).map((_, i) => {
					const y = 150 + i * 62;
					const changed = i === 2 || i === 5;
					return (
						<g key={i}>
							<line x1={52} y1={y + 44} x2={1148} y2={y + 44} stroke={C.line} />
							<rect x={72} y={y} width={200} height={10} rx="2" fill={changed ? C.muted : C.line2} opacity={changed ? 0.75 : 1} />
							<rect x={980} y={y} width={200} height={10} rx="2" fill={changed ? C.muted : C.line2} opacity={changed ? 0.75 : 1} />
							<line x1={600} y1={y + 5} x2={660} y2={y + 5} stroke={changed ? C.accent : C.line} strokeWidth="2" />
							<path
								d={changed ? "M 656 1 L 662 5 L 656 9" : "M 604 1 L 598 5 L 604 9"}
								stroke={changed ? C.accent : C.line}
								strokeWidth="2"
								fill="none"
							/>
						</g>
					);
				})}
				<circle cx="600" cy="660" r="5" fill={C.accent} />
				{t(614, 665, "2 CHANGED", C.accent)}
			</>
		),
		encrypt: (
			<>
				<Panel x={32} y={76} w={1136} h={642} title=".ENV — ENCRYPTED AT REST" />
				<rect x={52} y={120} width={1096} height={72} rx="8" fill={C.panel2} stroke={C.line} />
				{t(76, 150, "CIPHER", C.faint)}
				{t(76, 176, "AES-256-GCM", C.fg, 16)}
				{Array.from({ length: 6 }).map((_, i) => {
					const y = 216 + i * 70;
					return (
						<g key={i}>
							<line x1={52} y1={y + 52} x2={1148} y2={y + 52} stroke={C.line} />
							<rect x={72} y={y + 8} width={150} height={10} rx="2" fill={C.muted} opacity="0.6" />
							{t(238, y + 18, "=", C.faint)}
							<rect x={268} y={y + 5} width={300} height={14} rx="3" fill={C.line2} />
							<circle cx={1090} cy={y + 12} r="10" fill="none" stroke={C.accent} opacity="0.7" />
							<path d={`M 1086 ${y + 12} v -6 a 4 4 0 0 1 8 0 v 6`} fill="none" stroke={C.accent} opacity="0.7" />
						</g>
					);
				})}
			</>
		),
	};

	const labels: Record<ProductShotVariant, string> = {
		"control-room": "runmesh — control room",
		agents: "runmesh — agents",
		grants: "runmesh — grants",
		approvals: "runmesh — approvals",
		actions: "runmesh — runs",
		audit: "runmesh — audit",
		policies: "runmesh — policies",
		connect: "runmesh — connect",
		terminal: "runmesh cli",
		sync: "runmesh — sync",
		encrypt: "runmesh — encrypted env",
	};

	return (
		<svg viewBox="0 0 1200 750" role="img" aria-label={labels[variant]} className={cn("block h-auto w-full", className)}>
			<Frame label={labels[variant]}>{body[variant]}</Frame>
		</svg>
	);
}
