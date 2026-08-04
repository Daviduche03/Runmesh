export function SyncVisual() {
	const localFiles = ["src/", "package.json", "tsconfig.json", ".env.enc"]
	const cloudFiles = ["src/", "package.json", "tsconfig.json", ".env.enc"]

	return (
		<svg
			viewBox="0 0 288 224"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="mx-auto h-56 w-72"
			aria-hidden
		>
			<rect x="20" y="28" width="108" height="164" rx="6" fill="#0a0b0d" stroke="#363a42" />
			<text x="36" y="52" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10">
				local
			</text>
			<line x1="20" y1="60" x2="128" y2="60" stroke="#202329" />
			{localFiles.map((file, index) => (
				<rect key={file} x="32" y={76 + index * 26} width={84} height="18" rx="3" fill="#08090a" stroke="#30343c" />
			))}
			{localFiles.map((file, index) => (
				<text key={file} x="40" y={89 + index * 26} fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="9">
					{file}
				</text>
			))}

			<rect x="160" y="28" width="108" height="164" rx="6" fill="#0a0b0d" stroke="#4c525c" />
			<text x="176" y="52" fill="#6b7280" fontFamily="ui-monospace, monospace" fontSize="10">
				cloud
			</text>
			<line x1="160" y1="60" x2="268" y2="60" stroke="#202329" />
			{cloudFiles.map((file, index) => (
				<rect key={file} x="172" y={76 + index * 26} width={84} height="18" rx="3" fill="#08090a" stroke="#30343c" />
			))}
			{cloudFiles.map((file, index) => (
				<text key={file} x="180" y={89 + index * 26} fill="#8f949e" fontFamily="ui-monospace, monospace" fontSize="9">
					{file}
				</text>
			))}

			<line x1="136" y1="108" x2="152" y2="108" stroke="#4cb782" strokeWidth="1.5" />
			<polygon points="148,104 156,108 148,112" fill="#4cb782" />
			<text x="144" y="96" fill="#4cb782" fontFamily="ui-monospace, monospace" fontSize="8" textAnchor="middle">
				up
			</text>

			<line x1="136" y1="140" x2="152" y2="140" stroke="#6f7cff" strokeWidth="1.5" />
			<polygon points="152,136 144,140 152,144" fill="#6f7cff" />
			<text x="144" y="160" fill="#6f7cff" fontFamily="ui-monospace, monospace" fontSize="8" textAnchor="middle">
				down
			</text>
		</svg>
	)
}
