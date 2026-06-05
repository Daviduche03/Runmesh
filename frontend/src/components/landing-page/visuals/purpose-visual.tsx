export function PurposeVisual() {
	return (
		<svg
			viewBox="0 0 288 224"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="mx-auto h-56 w-72"
			aria-hidden
		>
			<rect x="20" y="20" width="248" height="184" rx="6" fill="#0a0b0d" stroke="#363a42" />
			<line x1="20" y1="52" x2="268" y2="52" stroke="#363a42" />
			<rect x="36" y="32" width="40" height="16" rx="3" fill="#141519" stroke="#363a42" />
			<text x="56" y="43" fill="#6f7cff" fontFamily="ui-monospace, monospace" fontSize="9" textAnchor="middle">
				POST
			</text>
			<text x="84" y="43" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10">
				/api/v1/tasks
			</text>
			<text x="36" y="78" fill="#4c525c" fontFamily="ui-monospace, monospace" fontSize="10">
				url
			</text>
			<rect x="72" y="66" width="176" height="20" rx="3" fill="#08090a" stroke="#30343c" />
			<text x="80" y="80" fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="10">
				https://app.com/webhook
			</text>
			<text x="36" y="108" fill="#4c525c" fontFamily="ui-monospace, monospace" fontSize="10">
				payload
			</text>
			<rect x="72" y="96" width="112" height="20" rx="3" fill="#08090a" stroke="#30343c" />
			<text x="80" y="110" fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="10">
				{"{ ...json }"}
			</text>
			<text x="36" y="138" fill="#4c525c" fontFamily="ui-monospace, monospace" fontSize="10">
				type
			</text>
			<rect x="72" y="126" width="56" height="20" rx="3" fill="#08090a" stroke="#30343c" />
			<text x="80" y="140" fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="10">
				task
			</text>
			<line x1="36" y1="168" x2="252" y2="168" stroke="#202329" />
			<text x="36" y="188" fill="#4c525c" fontFamily="ui-monospace, monospace" fontSize="10">
				response
			</text>
			<rect x="176" y="174" width="76" height="22" rx="4" fill="#0d0e10" stroke="#4c525c" />
			<text x="214" y="189" fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="10" textAnchor="middle">
				task_id
			</text>
		</svg>
	)
}
