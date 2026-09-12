import { cn } from "@/lib/utils"

export function WindowImage({
	base,
	alt,
	className,
	imgClassName,
}: {
	base: string
	alt: string
	className?: string
	imgClassName?: string
}) {
	return (
		<div className={cn("relative", className)}>
			<img
				src={`/bg/${base}.png`}
				alt={alt}
				loading="lazy"
				className={cn("w-full dark:hidden", imgClassName)}
			/>
			<img
				src={`/bg/${base}-dark.png`}
				alt={alt}
				loading="lazy"
				className={cn("hidden w-full dark:block", imgClassName)}
			/>
		</div>
	)
}
