/**
 * OnboardingGraphic — a plain, labelled diagram of what the workspace does.
 *
 * No metaphor. Agents on the left, the three controls in the middle
 * (Identity → Access → Control), the services they act on the right, and the
 * audit receipt underneath. A dot travels the whole path so the *flow* is
 * legible at a glance.
 *
 * Motion is CSS; the travelling dot is disabled under `prefers-reduced-motion`.
 */
const KEYFRAMES = `
.os-flow {
  transform-box: view-box;
  offset-path: path("M 306 400 H 1014");
  offset-anchor: 0 0;
  offset-rotate: 0deg;
  animation: os-flow 5.5s linear infinite;
}
@keyframes os-flow { to { offset-distance: 100%; } }
@media (prefers-reduced-motion: reduce) {
  .os-flow { animation: none !important; opacity: 0; }
}
`;

const PANEL = "#0e0f11";
const PANEL2 = "#131417";
const LINE = "#1c1d20";
const LINE2 = "#2a2b2f";
const FG = "#f4f2ee";
const MUTED = "#9a9ca1";
const FAINT = "#5f6166";
const ACCENT = "#e1683c";

const mono = "'IBM Plex Mono', ui-monospace, monospace";
const sans = "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif";

function Arrow({ x1, x2, y }: { x1: number; x2: number; y: number }) {
	return (
		<g>
			<line x1={x1} y1={y} x2={x2 - 10} y2={y} stroke={LINE2} strokeWidth="2" />
			<path d={`M ${x2 - 12} ${y - 6} L ${x2} ${y} L ${x2 - 12} ${y + 6} Z`} fill={ACCENT} />
		</g>
	);
}

export function OnboardingGraphic() {
	const agents = [
		{ y: 300, name: "research-agent" },
		{ y: 400, name: "ops-agent" },
		{ y: 500, name: "billing-agent" },
	];
	const services = [
		{ y: 300, name: "GitHub" },
		{ y: 400, name: "Stripe" },
		{ y: 500, name: "Google" },
	];
	const controls = [
		{ label: "01", title: "IDENTITY", copy: "an agent is a principal, not a key" },
		{ label: "02", title: "ACCESS", copy: "scoped, revocable, time-limited" },
		{ label: "03", title: "CONTROL", copy: "approvals, policy, audit" },
	];

	return (
		<svg
			viewBox="0 0 1320 760"
			role="img"
			aria-label="Diagram: your agents pass through Runmesh — identity, access, control — to reach services like GitHub, Stripe and Google, and every action is recorded."
			className="block h-auto w-full"
		>
			<style>{KEYFRAMES}</style>

			<defs>
				<radialGradient id="og-dot" cx="50%" cy="50%" r="50%">
					<stop offset="0%" stopColor={ACCENT} stopOpacity="1" />
					<stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
				</radialGradient>
			</defs>

			<rect x="0" y="0" width="1320" height="760" rx="16" fill="#0b0c0d" />
			<rect x="0.5" y="0.5" width="1319" height="759" rx="16" fill="none" stroke={LINE} />

			{/* column headers */}
			<text x="96" y="150" fontSize="12" letterSpacing="2.6" fill={FAINT} fontFamily={mono}>
				YOUR AGENTS
			</text>
			<text x="560" y="150" fontSize="12" letterSpacing="2.6" fill={MUTED} fontFamily={mono}>
				RUNMESH
			</text>
			<text x="1120" y="150" fontSize="12" letterSpacing="2.6" fill={FAINT} fontFamily={mono}>
				SERVICES
			</text>

			{/* agents */}
			{agents.map((agent) => (
				<g key={agent.name}>
					<rect x="60" y={agent.y - 40} width="240" height="80" rx="10" fill={PANEL} stroke={LINE} />
					<circle cx="98" cy={agent.y} r="16" fill={PANEL2} stroke={LINE2} />
					<circle cx="98" cy={agent.y} r="6" fill={MUTED} />
					<text x="128" y={agent.y - 4} fontSize="13" fill={FG} fontFamily={sans}>
						agent
					</text>
					<text x="128" y={agent.y + 16} fontSize="11" fill={MUTED} fontFamily={mono}>
						{agent.name}
					</text>
					<Arrow x1={306} x2={452} y={agent.y} />
				</g>
			))}

			{/* control plane */}
			<rect x="452" y="212" width="416" height="336" rx="12" fill={PANEL} stroke={LINE} />
			<rect x="452" y="212" width="416" height="42" rx="12" fill={PANEL2} />
			<rect x="452" y="242" width="416" height="12" fill={PANEL2} />
			<line x1="452" y1="254" x2="868" y2="254" stroke={LINE} />
			<circle cx="478" cy="233" r="5" fill={ACCENT} />
			<text x="494" y="238" fontSize="12" letterSpacing="2.4" fill={FG} fontFamily={mono}>
				RUNMESH
			</text>

			{controls.map((control, i) => {
				const y = 276 + i * 88;
				const tone = [ACCENT, "#5b9bf0", "#46a758"][i];
				return (
					<g key={control.title}>
						<rect x="472" y={y} width="376" height="72" rx="8" fill={PANEL2} stroke={LINE} />
						<text x="492" y={y + 30} fontSize="12" fill={tone} fontFamily={mono}>
							{control.label}
						</text>
						<text x="524" y={y + 30} fontSize="14" letterSpacing="1.6" fill={FG} fontFamily={mono} fontWeight="600">
							{control.title}
						</text>
						<text x="492" y={y + 54} fontSize="12" fill={MUTED} fontFamily={sans}>
							{control.copy}
						</text>
					</g>
				);
			})}

			{/* services */}
			{services.map((service) => (
				<g key={service.name}>
					<Arrow x1={868} x2={1014} y={service.y} />
					<rect x="1014" y={service.y - 40} width="246" height="80" rx="10" fill={PANEL} stroke={LINE} />
					<rect x="1042" y={service.y - 16} width="32" height="32" rx="8" fill={PANEL2} stroke={LINE2} />
					<circle cx="1058" cy={service.y} r="8" fill={MUTED} opacity="0.6" />
					<text x="1090" y={service.y + 5} fontSize="14" fill={FG} fontFamily={sans}>
						{service.name}
					</text>
				</g>
			))}

			{/* the audit receipt */}
			<rect x="452" y="588" width="808" height="96" rx="12" fill={PANEL} stroke={LINE} />
			<rect x="452" y="588" width="6" height="96" rx="3" fill={ACCENT} />
			<text x="484" y="626" fontSize="12" letterSpacing="2.4" fill={ACCENT} fontFamily={mono}>
				EVERY ACTION RECORDED
			</text>
			<text x="484" y="652" fontSize="13" fill={MUTED} fontFamily={sans}>
				Which agent, on whose behalf, with what scope, approved by whom — and the result.
			</text>
			{[0, 1, 2, 3].map((i) => (
				<g key={i}>
					<rect x={1020 + i * 60} y="608" width="44" height="8" rx="2" fill={LINE2} />
					<circle cx={1042 + i * 60} cy={648} r="4" fill={[ACCENT, "#5b9bf0", "#46a758", MUTED][i]} />
				</g>
			))}

			{/* flow dot: agent → gates → service */}
			<g className="os-flow">
				<circle cx="0" cy="0" r="16" fill="url(#og-dot)" />
				<circle cx="0" cy="0" r="5" fill={ACCENT} />
			</g>
		</svg>
	);
}
