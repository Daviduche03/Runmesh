import type React from "react"
import { cn } from "@/lib/utils"

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

export const Logo = (props: React.ComponentProps<"svg">) => (
	<svg viewBox="0 0 114 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
		<g transform="translate(0 0)">
			<LogoMark />
		</g>
		<text
			x="28"
			y="17"
			fontSize="16"
			fontWeight="650"
			fill="currentColor"
			fontFamily="Inter, SF Pro Display, -apple-system, sans-serif"
			letterSpacing="-0.035em"
		>
			Runmesh
		</text>
	</svg>
)

export const LogoBadge = ({
	className,
	iconClassName,
}: {
	className?: string
	iconClassName?: string
}) => (
	<span
		className={cn(
			"grid size-8 place-items-center rounded-md border border-border bg-muted text-foreground",
			className
		)}
	>
		<LogoIcon className={cn("size-5", iconClassName)} />
	</span>
)
