import { cn } from "@/lib/utils"

/** Subtle film grain that keeps large flat tints from reading as a CSS panel. */
export function Grain({ opacity = 0.16 }: { opacity?: number }) {
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 mix-blend-multiply"
			style={{
				opacity,
				backgroundImage:
					"url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/></filter><rect width='140' height='140' filter='url(%23n)'/></svg>\")",
			}}
		/>
	)
}

/**
 * DotField: a grid of small squares where some are lit. Used as a texture
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
