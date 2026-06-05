export function AgentsVisual() {
	const states = ["queued", "scheduled", "dispatch"]
	const boxWidth = 68
	const gap = 24
	const startX = (288 - (boxWidth * 3 + gap * 2)) / 2

	return (
		<svg
			viewBox="0 0 288 224"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="mx-auto h-56 w-72"
			aria-hidden
		>
			<rect x="20" y="72" width="248" height="80" rx="6" fill="#08090a" stroke="#202329" />
			{states.map((label, index) => {
				const x = startX + index * (boxWidth + gap)
				return (
					<g key={label}>
						<rect x={x} y="96" width={boxWidth} height="32" rx="5" fill="#0a0b0d" stroke="#363a42" />
						<text
							x={x + boxWidth / 2}
							y="116"
							fill="#8f949e"
							fontFamily="ui-monospace, monospace"
							fontSize="10"
							textAnchor="middle"
						>
							{label}
						</text>
						{index < states.length - 1 && (
							<>
								<line
									x1={x + boxWidth + 4}
									y1="112"
									x2={x + boxWidth + gap - 4}
									y2="112"
									stroke="#4c525c"
									strokeWidth="1.5"
								/>
								<polygon
									points={`${x + boxWidth + gap - 8},108 ${x + boxWidth + gap - 2},112 ${x + boxWidth + gap - 8},116`}
									fill="#4c525c"
								/>
							</>
						)}
					</g>
				)
			})}
		</svg>
	)
}
