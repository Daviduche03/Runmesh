import type React from "react"
import { cn } from "@/lib/utils"

export function SectionLabel({
	index,
	children,
	className,
}: {
	index: string
	children: React.ReactNode
	className?: string
}) {
	return (
		<div
			className={cn(
				"flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--rm-accent)]",
				className
			)}
		>
			<span className="text-[var(--rm-faint)]">[{index}]</span>
			<span>{children}</span>
		</div>
	)
}
