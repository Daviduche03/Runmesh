export function TriageVisual() {
	const items = [
		{ icon: "accept", offset: 0 },
		{ icon: "copy", offset: 16 },
		{ icon: "decline", offset: 32 },
	]

	return (
		<svg
			viewBox="0 0 320 224"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="mx-auto h-56 w-[320px]"
			aria-hidden
		>
			<line x1="48" y1="200" x2="272" y2="200" stroke="#202329" />
			{items.map(({ icon, offset }, index) => (
				<g key={icon} transform={`translate(${offset}, ${index * 58})`}>
					<rect x="48" y="34" width="224" height="48" rx="5" fill="#0a0b0d" stroke="#363a42" />
					<image href={`/assets/${icon}.svg`} x="64" y="50" width="16" height="16" opacity="0.7" />
					<rect x="92" y="56" width="112" height="8" rx="2" fill="#343840" />
				</g>
			))}
		</svg>
	)
}
