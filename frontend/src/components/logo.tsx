import type React from "react"
import { cn } from "@/lib/utils"

const LogoMark = () => (
	<>
		<path
			d="M7 6.2 12.8 10.2M7 12h5.8M7 17.8 12.8 13.8M18.2 12H21M20.2 10.6 21.6 12 20.2 13.4"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
		<circle cx="5.5" cy="6" r="1.75" fill="currentColor" />
		<circle cx="5.5" cy="12" r="1.75" fill="currentColor" />
		<circle cx="5.5" cy="18" r="1.75" fill="currentColor" />
		<circle cx="15.5" cy="12" r="2.75" fill="currentColor" />
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
