import type React from "react"

export function LinearBentoCard({
	fig,
	title,
	copy,
	children,
}: {
	fig: string
	title: string
	copy: string
	children: React.ReactNode
}) {
	return (
		<article className="group flex min-h-[470px] flex-col border-[#202329] md:border-r md:last:border-r-0">
			<div className="px-8 font-mono text-[12px] tracking-[0.16em] text-[#383c44]">{fig}</div>
			<div className="flex flex-1 items-center justify-center py-10 opacity-80 transition-opacity duration-300 group-hover:opacity-100">
				{children}
			</div>
			<div className="px-8 pb-1">
				<h3 className="mb-3 text-[16px] font-[590] tracking-[-0.01em] text-[#d8dce3]">{title}</h3>
				<p className="max-w-[310px] text-[16px] leading-6 text-[#8f949e]">{copy}</p>
			</div>
		</article>
	)
}
