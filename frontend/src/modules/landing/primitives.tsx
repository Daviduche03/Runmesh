import type React from "react"
import { cn } from "@/lib/utils"

/**
 * A browser chrome frame around a product screenshot. Reference sites lean on
 * this to make a flat image read as "a real app someone is running".
 */
export function BrowserFrame({
	src,
	alt,
	className,
	frameClassName,
	url = "app.runmesh.dev",
}: {
	src: string
	alt: string
	className?: string
	frameClassName?: string
	url?: string
}) {
	return (
		<div
			className={cn(
				"overflow-hidden rounded-xl border border-[var(--rm-line)] bg-white shadow-[0_1px_2px_rgba(20,19,17,0.04),0_18px_48px_-24px_rgba(20,19,17,0.28)]",
				frameClassName
			)}
		>
			<div className="flex h-9 items-center gap-2 border-b border-[var(--rm-line)] bg-[var(--rm-panel-2)] px-3">
				<span className="size-2.5 rounded-full bg-[#ff5f57]" />
				<span className="size-2.5 rounded-full bg-[#febc2e]" />
				<span className="size-2.5 rounded-full bg-[#28c840]" />
				<div className="mx-auto flex h-5 w-2/5 max-w-[280px] items-center justify-center gap-1.5 rounded-[4px] bg-white px-3 font-mono text-[10px] text-[var(--rm-faint)]">
					<svg viewBox="0 0 12 12" className="size-2.5 shrink-0 fill-none stroke-current" strokeWidth="1.4">
						<rect x="2.6" y="5" width="6.8" height="5" rx="1" />
						<path d="M4 5V3.6a2 2 0 0 1 4 0V5" />
					</svg>
					<span className="truncate">{url}</span>
				</div>
			</div>
			<img
				src={src}
				alt={alt}
				loading="lazy"
				decoding="async"
				className={cn("block w-full", className)}
			/>
		</div>
	)
}

/**
 * DotField — a grid of small squares where some are lit. Used as a texture
 * behind feature cards, echoing the dot-matrix graphics on reference sites.
 * `lit` is a list of indices (row * cols + col) to fill.
 */
export function DotField({
	cols = 10,
	rows = 10,
	lit = [],
	className,
	size = 6,
	gap = 4,
}: {
	cols?: number
	rows?: number
	lit?: number[]
	className?: string
	size?: number
	gap?: number
}) {
	const cells = []
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const index = r * cols + c
			const isLit = lit.includes(index)
			cells.push(
				<span
					key={index}
					className={cn(
						"rounded-[1.5px]",
						isLit ? "bg-[var(--rm-accent)]" : "bg-[var(--rm-line-strong)]"
					)}
					style={{ width: size, height: size }}
				/>
			)
		}
	}
	return (
		<div
			aria-hidden="true"
			className={cn("grid", className)}
			style={{ gridTemplateColumns: `repeat(${cols}, ${size}px)`, gap }}
		>
			{cells}
		</div>
	)
}

/** Small uppercase eyebrow label with a leading rule. */
export function Eyebrow({
	children,
	className,
}: {
	children: React.ReactNode
	className?: string
}) {
	return (
		<div
			className={cn(
				"flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--rm-faint)]",
				className
			)}
		>
			<span className="h-px w-6 bg-[var(--rm-line-strong)]" />
			{children}
		</div>
	)
}
