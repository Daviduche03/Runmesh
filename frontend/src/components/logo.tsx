import type React from "react"

const LogoMark = () => (
	<>
		<circle cx="6" cy="6" r="1.75" fill="currentColor" />
		<circle cx="18" cy="6" r="1.75" fill="currentColor" />
		<circle cx="6" cy="18" r="1.75" fill="currentColor" />
		<circle cx="18" cy="18" r="1.75" fill="currentColor" />
		<path
			d="M6 6C10.5 9 13.5 15 18 18"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			fill="none"
		/>
		<path
			d="M6 18C10.5 15 13.5 9 18 6"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			fill="none"
		/>
	</>
)

export const LogoIcon = (props: React.ComponentProps<"svg">) => (
	<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
		<LogoMark />
	</svg>
)
