export function FuseVisual() {
	const tree = [
		{ name: "src/", depth: 1, dim: false },
		{ name: "components/", depth: 2, dim: false },
		{ name: "app.tsx", depth: 3, dim: false },
		{ name: "package.json", depth: 1, dim: false },
		{ name: "node_modules/", depth: 1, dim: true },
		{ name: "dist/", depth: 1, dim: true },
	]

	return (
		<svg
			viewBox="0 0 288 224"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="mx-auto h-56 w-72"
			aria-hidden
		>
			<rect x="20" y="16" width="248" height="84" rx="6" fill="#0a0b0d" stroke="#363a42" />
			<text x="36" y="40" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10">
				~/code/midday (FUSE)
			</text>
			<line x1="20" y1="48" x2="268" y2="48" stroke="#202329" />
			{tree.map((entry, index) => {
				const baseY = 60 + index * 12
				return (
					<g key={entry.name}>
						<circle cx={36 + entry.depth * 10} cy={baseY + 3} r="2" fill={entry.dim ? "#4c525c" : "#6f7cff"} />
						<text
							x={44 + entry.depth * 10}
							y={baseY + 6}
							fill={entry.dim ? "#4c525c" : "#8f949e"}
							fontFamily="ui-monospace, monospace"
							fontSize="9"
						>
							{entry.name}
						</text>
					</g>
				)
			})}

			<line x1="144" y1="104" x2="144" y2="120" stroke="#4c525c" strokeWidth="1.5" />
			<polygon points="140,118 148,118 144,124" fill="#4c525c" />

			<rect x="40" y="124" width="208" height="84" rx="6" fill="#0a0b0d" stroke="#4c525c" />
			<text x="56" y="148" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10">
				bucket/midday/
			</text>
			<line x1="40" y1="156" x2="248" y2="156" stroke="#202329" />
			<text x="56" y="174" fill="#4c525c" fontFamily="ui-monospace, monospace" fontSize="9">
				lazy fetch on open
			</text>
			<text x="56" y="190" fill="#4cb782" fontFamily="ui-monospace, monospace" fontSize="9">
				write-back on close
			</text>
		</svg>
	)
}
