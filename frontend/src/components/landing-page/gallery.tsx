import { cn } from "@/lib/utils"
import { container, sectionY } from "./constants"
import { SectionHeading } from "./section-heading"
import { WindowImage } from "./window-image"

const screens = [
	{
		image: "ui-4",
		label: "API",
		title: "A stable HTTP surface",
		copy: "One POST creates a task. Webhooks and pollable run state tell you how it finished.",
		className: "md:col-span-2",
	},
	{
		image: "ui-8",
		label: "Logs",
		title: "Tail a run in real time",
		copy: "Filter by level, follow retries, and export what you find.",
		className: "",
	},
	{
		image: "ui-9",
		label: "Workspace",
		title: "One shared source of truth",
		copy: "Runmesh Workspace keeps project files in sync across devices and coding agents.",
		className: "",
	},
]

function ScreenCard({
	image,
	label,
	title,
	copy,
	className,
}: {
	image: string
	label: string
	title: string
	copy: string
	className?: string
}) {
	return (
		<article className={cn("group relative overflow-hidden border border-[var(--rm-line)]", className)}>
			<img
				src="/bg/texture-light.jpg"
				alt=""
				aria-hidden
				className="absolute inset-0 h-full w-full object-cover dark:hidden"
			/>
			<img
				src="/bg/texture-dark.jpg"
				alt=""
				aria-hidden
				className="absolute inset-0 hidden h-full w-full object-cover dark:block"
			/>
			<div className="absolute inset-0 bg-[var(--rm-bg)]/45" />
			<div className="relative p-5 sm:p-7">
				<WindowImage
					base={image}
					alt={title}
					imgClassName="transition-transform duration-500 ease-out group-hover:-translate-y-1"
				/>
			</div>
			<div className="relative border-t border-[var(--rm-line)] px-5 py-5 sm:px-7">
				<div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--rm-accent)]">{label}</div>
				<h3 className="mt-2 font-display text-[18px] font-medium tracking-[-0.02em] text-[var(--rm-fg)]">{title}</h3>
				<p className="mt-1.5 max-w-[440px] text-[14px] leading-6 text-[var(--rm-muted)]">{copy}</p>
			</div>
		</article>
	)
}

export function Gallery() {
	return (
		<section id="interface" className={`scroll-mt-14 border-b border-[var(--rm-line)] ${sectionY}`}>
			<div className={container}>
				<SectionHeading index="03" label="Interface" title="The interface your team will actually use">
					The same screens your engineers use to operate agents in production — not a separate admin tool bolted on
					top.
				</SectionHeading>

				<div className="mt-14 grid gap-4 md:grid-cols-2">
					{screens.map((screen) => (
						<ScreenCard key={screen.image} {...screen} />
					))}
				</div>
			</div>
		</section>
	)
}
