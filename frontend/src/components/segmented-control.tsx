import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SegmentedControl<T extends string>({
	options,
	value,
	onChange,
}: {
	options: readonly { label: ReactNode; value: T }[];
	value: T;
	onChange: (value: T) => void;
}) {
	return (
		<div className="inline-flex w-fit max-w-full items-center gap-0.5 rounded-[4px] border border-border p-0.5">
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					onClick={() => onChange(option.value)}
					className={cn(
						"flex items-center gap-2 rounded-[3px] px-2.5 py-1 text-[12px] font-medium transition-[background-color,color,transform] duration-150 ease-[var(--ease-out)] active:scale-[0.97] motion-reduce:active:scale-100",
						value === option.value
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:text-foreground"
					)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}
