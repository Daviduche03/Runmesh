export function MiniDashboardVisual() {
	const statuses = [
		{ label: "queued", color: "#6f7cff" },
		{ label: "running", color: "#6f7cff" },
		{ label: "completed", color: "#4cb782" },
		{ label: "failed", color: "#eb5757" },
	]

	return (
		<svg
			viewBox="0 0 320 224"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="mx-auto h-56 w-[320px]"
			aria-hidden
		>
			<rect x="24" y="16" width="272" height="176" rx="5" fill="#0a0b0d" stroke="#363a42" />
			<line x1="24" y1="48" x2="296" y2="48" stroke="#363a42" />
			<text x="40" y="36" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10">
				POST /publish
			</text>
			{statuses.map(({ label, color }, index) => (
				<g key={label}>
					<rect x="40" y={60 + index * 32} width="168" height="24" rx="4" fill="#08090a" stroke="#363a42" />
					<circle cx="52" cy={72 + index * 32} r="3" fill={color} />
					<text x="64" y={76 + index * 32} fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="10">
						{label}
					</text>
				</g>
			))}
			<rect x="208" y="88" width="72" height="72" rx="5" fill="#0d0e10" stroke="#4c525c" />
			<text x="244" y="118" fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="9" textAnchor="middle">
				idempotency
			</text>
			<text x="244" y="132" fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="9" textAnchor="middle">
				_key
			</text>
		</svg>
	)
}
