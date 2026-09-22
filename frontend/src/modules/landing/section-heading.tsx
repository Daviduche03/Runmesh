import type React from "react"
import { cn } from "@/lib/utils"
import { SectionLabel } from "./section-label"

export function SectionHeading({
	index,
	label,
	title,
	children,
	className,
}: {
	index: string
	label: string
	title: React.ReactNode
	children?: React.ReactNode
	className?: string
}) {
	return (
		<div className={cn("grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-end", className)}>
			<div>
				<SectionLabel index={index}>{label}</SectionLabel>
				<h2 className="mt-5 max-w-[720px] text-balance font-display text-[clamp(28px,3.4vw,44px)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--rm-fg)]">
					{title}
				</h2>
			</div>
			{children ? (
				<p className="max-w-[380px] text-[15px] leading-7 text-[var(--rm-muted)] lg:justify-self-end lg:pb-1">{children}</p>
			) : null}
		</div>
	)
}
