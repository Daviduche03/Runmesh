export function AgentsVisual() {
	const states = ["queued", "scheduled", "dispatch"]
	const container = { x: 20, y: 72, width: 248, height: 80 }
	const boxWidth = 64
	const boxHeight = 32
	const gap = 20
	const totalWidth = boxWidth * states.length + gap * (states.length - 1)
	const startX = container.x + (container.width - totalWidth) / 2
	const startY = container.y + (container.height - boxHeight) / 2
	const arrowY = startY + boxHeight / 2

	return (
		<svg
			viewBox="0 0 288 224"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="mx-auto h-56 w-72"
			aria-hidden
		>
			<rect
				x={container.x}
				y={container.y}
				width={container.width}
				height={container.height}
				rx="6"
				fill="#08090a"
				stroke="#202329"
			/>
			{states.map((label, index) => {
				const x = startX + index * (boxWidth + gap)
				return (
					<g key={label}>
						<rect x={x} y={startY} width={boxWidth} height={boxHeight} rx="5" fill="#0a0b0d" stroke="#363a42" />
						<text
							x={x + boxWidth / 2}
							y={startY + boxHeight / 2 + 4}
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
									y1={arrowY}
									x2={x + boxWidth + gap - 4}
									y2={arrowY}
									stroke="#4c525c"
									strokeWidth="1.5"
								/>
								<polygon
									points={`${x + boxWidth + gap - 8},${arrowY - 4} ${x + boxWidth + gap - 2},${arrowY} ${x + boxWidth + gap - 8},${arrowY + 4}`}
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
