import type React from "react"

export function Badge({ children }: { children: React.ReactNode }) {
	return (
		<div className="mb-5 w-fit rounded-md border border-[#1a2e3a] bg-[#0a1a24] px-3 py-1.5 text-[13px] font-[590] text-[#44b8d4]">
			{children}
		</div>
	)
}
