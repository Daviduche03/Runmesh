import type React from "react"

export function Badge({ children }: { children: React.ReactNode }) {
	return (
		<div className="mb-5 w-fit rounded-md border border-[#3a321a] bg-[#18150b] px-3 py-1.5 text-[13px] font-[590] text-[#d4b144]">
			{children}
		</div>
	)
}
