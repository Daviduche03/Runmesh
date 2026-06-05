import type React from "react"
import { Badge } from "./badge"

export function SectionIntro({
	badge,
	title,
	children,
}: {
	badge: string
	title: string
	children: React.ReactNode
}) {
	return (
		<div className="mb-10 grid gap-6 lg:grid-cols-[0.95fr_1fr] lg:items-end">
			<div>
				<Badge>{badge}</Badge>
				<h2 className="max-w-[640px] text-balance text-[clamp(34px,4vw,56px)] font-[590] leading-[1.04] tracking-[-0.05em] text-white">
					{title}
				</h2>
			</div>
			<p className="max-w-[560px] text-[17px] leading-7 tracking-[-0.015em] text-[#8f949e]">{children}</p>
		</div>
	)
}
