export function EnvVisual() {
	return (
		<svg
			viewBox="0 0 288 224"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="mx-auto h-56 w-72"
			aria-hidden
		>
			<rect x="24" y="32" width="108" height="160" rx="6" fill="#0a0b0d" stroke="#363a42" />
			<text x="40" y="56" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10">
				.env
			</text>
			<line x1="24" y1="64" x2="132" y2="64" stroke="#202329" />
			<text x="40" y="88" fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="9">
				API_KEY=•••••
			</text>
			<text x="40" y="108" fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="9">
				SECRET=•••••
			</text>
			<text x="40" y="128" fill="#4c525c" fontFamily="ui-monospace, monospace" fontSize="9">
				plaintext
			</text>

			<line x1="140" y1="112" x2="156" y2="112" stroke="#4c525c" strokeWidth="1.5" />
			<polygon points="152,108 160,112 152,116" fill="#4c525c" />

			<rect x="160" y="32" width="108" height="160" rx="6" fill="#0a0b0d" stroke="#4c525c" />
			<text x="176" y="56" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10">
				.env.enc
			</text>
			<line x1="160" y1="64" x2="268" y2="64" stroke="#202329" />
			<text x="176" y="88" fill="#4c525c" fontFamily="ui-monospace, monospace" fontSize="9">
				RME1 ••••••••
			</text>
			<text x="176" y="108" fill="#4c525c" fontFamily="ui-monospace, monospace" fontSize="9">
				AES-256-GCM
			</text>
			<text x="176" y="128" fill="#4cb782" fontFamily="ui-monospace, monospace" fontSize="9">
				ciphertext
			</text>

			<rect x="76" y="176" width="136" height="40" rx="6" fill="#0d0e10" stroke="#4c525c" />
			<rect x="108" y="156" width="72" height="18" rx="4" fill="#0d0e10" stroke="#6f7cff" />
			<path
				d="M120 156v-6a24 24 0 0 1 48 0v6"
				stroke="#6f7cff"
				strokeWidth="2"
				fill="none"
			/>
			<rect x="128" y="164" width="32" height="20" rx="3" fill="#0d0e10" stroke="#6f7cff" />
			<text x="144" y="200" fill="#6f7cff" fontFamily="ui-monospace, monospace" fontSize="9" textAnchor="middle">
				key never leaves device
			</text>
		</svg>
	)
}
