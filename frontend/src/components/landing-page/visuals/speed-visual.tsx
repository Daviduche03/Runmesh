export function SpeedVisual() {
	const queueBars = [56, 48, 40]
	const webhookBars = [64, 48, 56, 32]

	return (
		<svg
			viewBox="0 0 288 224"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="mx-auto h-56 w-72"
			aria-hidden
		>
			<rect x="28" y="48" width="88" height="128" rx="5" fill="#0a0b0d" stroke="#363a42" />
			<text x="72" y="68" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10" textAnchor="middle">
				queue
			</text>
			<line x1="36" y1="76" x2="108" y2="76" stroke="#202329" />
			{queueBars.map((width, index) => (
				<rect
					key={index}
					x="40"
					y={88 + index * 28}
					width={width}
					height="8"
					rx="2"
					fill="#30343c"
				/>
			))}
			<rect x="172" y="48" width="88" height="128" rx="5" fill="#0a0b0d" stroke="#4c525c" />
			<text x="216" y="68" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10" textAnchor="middle">
				webhook
			</text>
			<line x1="180" y1="76" x2="252" y2="76" stroke="#202329" />
			{webhookBars.map((width, index) => (
				<rect
					key={index}
					x="184"
					y={88 + index * 24}
					width={width}
					height="8"
					rx="2"
					fill={index === 0 ? "#4cb782" : "#30343c"}
					opacity={index === 0 ? 0.85 : 1}
				/>
			))}
			<line x1="124" y1="112" x2="160" y2="112" stroke="#4c525c" strokeWidth="1.5" />
			<polygon points="156,108 164,112 156,116" fill="#4c525c" />
			<text x="142" y="100" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="9" textAnchor="middle">
				POST
			</text>
		</svg>
	)
}
