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
import { ChevronDownIcon } from "lucide-react";
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
}: {
	value: T;
	onChange: (value: T) => void;
	options: readonly FormSelectOption<T>[];
	placeholder?: string;
	className?: string;
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
						selected ? "text-foreground" : "text-muted-foreground",
						className
					)}
				>
					<span className="truncate">{selected?.label ?? placeholder ?? "Select…"}</span>
					<ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-[var(--ease-out)]" />
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
											"px-2 pt-2 pb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70",
											!isFirstGroup && "mt-1 border-t border-border"
										)}
									>
										{option.group}
									</div>
								) : null}
								<DropdownMenuRadioItem value={option.value} disabled={option.disabled}>
									{option.label}
								</DropdownMenuRadioItem>
							</Fragment>
						);
					})}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
