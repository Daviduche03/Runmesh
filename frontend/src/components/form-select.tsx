"use client";

import { Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export type FormSelectOption<T extends string> = {
	label: ReactNode;
	value: T;
	disabled?: boolean;
	/** Options sharing a group render under one heading. */
	group?: string;
};

export function FormSelect<T extends string>({
	value,
	onChange,
	options,
	placeholder,
	className,
	contentClassName,
}: {
	value: T;
	onChange: (value: T) => void;
	options: readonly FormSelectOption<T>[];
	placeholder?: string;
	className?: string;
	/** Applied to option labels inside the open menu (not the trigger). */
	contentClassName?: string;
}) {
	const selected = options.find((option) => option.value === value);
	const hasGroups = options.some((option) => option.group !== undefined);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="outline"
					className={cn(
						"h-9 w-full justify-between font-normal transition-[background-color,border-color] duration-150 ease-[var(--ease-out)] [&[data-state=open]>svg]:rotate-180",
						className,
						selected ? "text-foreground" : "text-muted-foreground"
					)}
				>
					<span className="truncate">{selected?.label ?? placeholder ?? "Select…"}</span>
					<CaretDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-[var(--ease-out)]" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="max-h-80 min-w-48 overflow-y-auto">
				<DropdownMenuRadioGroup
					value={value}
					onValueChange={(next) => onChange(next as T)}
					className={cn("grid", !hasGroups && "divide-y divide-border")}
				>
					{options.map((option, index) => {
						const previous = options[index - 1];
						const isNewGroup = option.group !== undefined && option.group !== previous?.group;
						const isFirstGroup = isNewGroup && previous?.group === undefined;
						return (
							<Fragment key={option.value}>
								{isNewGroup ? (
									<div
										role="presentation"
										className={cn(
											"px-2 pt-2 pb-1 text-[11px] font-medium tracking-[0.02em] text-muted-foreground/70",
											!isFirstGroup && "mt-1 border-t border-border"
										)}
									>
										{option.group}
									</div>
								) : null}
								<DropdownMenuRadioItem value={option.value} disabled={option.disabled}>
									<span className={cn("min-w-0 truncate", contentClassName)}>{option.label}</span>
								</DropdownMenuRadioItem>
							</Fragment>
						);
					})}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
