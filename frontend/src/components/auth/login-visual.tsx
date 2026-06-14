export function LoginVisual() {
	const queueBars = [72, 58, 46, 36]

	return (
		<svg
			viewBox="0 0 360 260"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="mx-auto block h-auto w-full max-w-[380px]"
			aria-hidden
			preserveAspectRatio="xMidYMid meet"
		>
			<line x1="16" y1="44" x2="344" y2="44" stroke="#202329" />
			<text x="16" y="28" fill="#d8dce3" fontFamily="ui-monospace, monospace" fontSize="11">
				task lifecycle
			</text>
			<text x="344" y="28" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10" textAnchor="end">
				publish → queue → dispatch
			</text>

			<rect x="16" y="60" width="96" height="120" rx="6" fill="#08090a" stroke="#363a42" />
			<rect x="28" y="74" width="44" height="20" rx="4" fill="#141519" stroke="#363a42" />
			<text x="50" y="88" fill="#6f7cff" fontFamily="ui-monospace, monospace" fontSize="10" textAnchor="middle">
				POST
			</text>
			<text x="28" y="112" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10">
				/api/v1/tasks
			</text>
			<rect x="28" y="122" width="72" height="10" rx="2" fill="#30343c" />
			<rect x="28" y="138" width="56" height="10" rx="2" fill="#30343c" />
			<rect x="28" y="154" width="64" height="10" rx="2" fill="#30343c" />
			<text x="64" y="178" fill="#4c525c" fontFamily="ui-monospace, monospace" fontSize="9" textAnchor="middle">
				publish
			</text>

			<line x1="120" y1="120" x2="136" y2="120" stroke="#4c525c" strokeWidth="1.5" />
			<polygon points="132,116 140,120 132,124" fill="#4c525c" />

			<rect x="144" y="60" width="96" height="120" rx="6" fill="#08090a" stroke="#363a42" />
			<text x="192" y="84" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10" textAnchor="middle">
				queue
			</text>
			<line x1="156" y1="94" x2="228" y2="94" stroke="#202329" />
			{queueBars.map((width, index) => (
				<rect
					key={index}
					x="156"
					y={104 + index * 18}
					width={width}
					height="10"
					rx="2"
					fill={index === 0 ? "#4c525c" : "#30343c"}
				/>
			))}
			<rect x="156" y="168" width="72" height="20" rx="4" fill="#0d0e10" stroke="#30343c" strokeDasharray="3 3" />
			<text x="192" y="182" fill="#e5a54b" fontFamily="ui-monospace, monospace" fontSize="9" textAnchor="middle">
				14:30 UTC
			</text>

			<line x1="248" y1="120" x2="264" y2="120" stroke="#4c525c" strokeWidth="1.5" />
			<polygon points="260,116 268,120 260,124" fill="#4c525c" />
			<text x="256" y="110" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="9" textAnchor="middle">
				POST
			</text>

			<rect x="272" y="60" width="72" height="120" rx="6" fill="#08090a" stroke="#4c525c" />
			<text x="308" y="84" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10" textAnchor="middle">
				webhook
			</text>
			<line x1="284" y1="94" x2="332" y2="94" stroke="#202329" />
			<rect x="284" y="104" width="40" height="10" rx="2" fill="#4cb782" opacity="0.85" />
			<rect x="284" y="120" width="36" height="10" rx="2" fill="#30343c" />
			<rect x="284" y="136" width="44" height="10" rx="2" fill="#30343c" />
			<rect x="284" y="152" width="32" height="10" rx="2" fill="#30343c" />
			<rect x="292" y="168" width="32" height="18" rx="4" fill="#0d1a12" stroke="#4cb782" />
			<text x="308" y="180" fill="#4cb782" fontFamily="ui-monospace, monospace" fontSize="9" textAnchor="middle">
				200
			</text>

			<line x1="16" y1="204" x2="344" y2="204" stroke="#202329" />
			<circle cx="24" cy="228" r="3" fill="#4c525c" />
			<text x="36" y="232" fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="10">
				HTTP tasks
			</text>
			<circle cx="156" cy="228" r="3" fill="#e5a54b" />
			<text x="168" y="232" fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="10">
				UTC scheduling
			</text>
			<circle cx="268" cy="228" r="3" fill="#4cb782" />
			<text x="280" y="232" fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="10">
				webhook POSTs
			</text>
		</svg>
	)
}
