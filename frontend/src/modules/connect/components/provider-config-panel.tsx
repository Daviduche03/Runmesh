"use client";

import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ProviderLogo, type Provider } from "@/modules/connect/components/providers-table";
import { Button } from "@/components/ui/button";
import { SheetClose } from "@/components/ui/sheet";
import { Check, Copy } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const CALLBACK_URL = "https://connect.runmesh.app/oauth/callback";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<div className="grid gap-1.5">
			<span className="text-[12px] text-muted-foreground">{label}</span>
			{children}
			{hint ? <p className="text-[11px] text-muted-foreground/70">{hint}</p> : null}
		</div>
	);
}

function CopyField({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="flex items-center gap-2">
			<Input readOnly value={value} className="font-mono text-[12px]" />
			<button
				type="button"
				aria-label="Copy"
				onClick={() => {
					navigator.clipboard.writeText(value);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				}}
				className="shrink-0 text-muted-foreground transition-[color,transform] duration-150 ease-[var(--ease-out)] hover:text-foreground active:scale-[0.9]"
			>
				{copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
			</button>
		</div>
	);
}

function ScopePicker({ scopes }: { scopes: string[] }) {
	const [selected, setSelected] = useState<Set<string>>(() => new Set(scopes));

	const toggle = (scope: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(scope)) next.delete(scope);
			else next.add(scope);
			return next;
		});
	};

	return (
		<div className="grid gap-1.5">
			<div className="flex items-baseline justify-between gap-3">
				<span className="text-[12px] text-muted-foreground">Scopes</span>
				<span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
					{selected.size} of {scopes.length} selected
				</span>
			</div>
			<p className="text-[11px] text-muted-foreground/70">Pick the scopes to request.</p>
			<ul className="grid gap-0.5">
				{scopes.map((scope) => {
					const checked = selected.has(scope);
					return (
						<li key={scope}>
							<button
								type="button"
								role="checkbox"
								aria-checked={checked}
								onClick={() => toggle(scope)}
								className="flex w-full cursor-pointer items-center gap-2.5 rounded-[4px] px-1.5 py-1.5 text-left transition-[background-color] duration-150 ease-[var(--ease-out)] hover:bg-muted/50 active:scale-[0.99]"
							>
								<span
									aria-hidden
									className={cn(
										"grid size-3.5 shrink-0 place-items-center rounded-[3px] border transition-[background-color,border-color] duration-150 ease-[var(--ease-out)]",
										checked ? "border-primary bg-primary" : "border-input bg-transparent"
									)}
								>
									{checked ? <Check className="size-2.5 text-primary-foreground" weight="bold" /> : null}
								</span>
								<span className={cn("min-w-0 flex-1 truncate font-mono text-[12.5px]", checked ? "text-foreground" : "text-muted-foreground")}>
									{scope}
								</span>
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

export function ProviderConfigPanel({ provider }: { provider: Provider }) {
	const scheme = provider.auth[0] ?? "none";
	const showScopes = provider.scopes.length > 0;

	return (
		<>
			<SheetHeader>
				<div className="flex items-start gap-3">
					<span className="mt-0.5">
						<ProviderLogo provider={provider} size={24} />
					</span>
					<div className="min-w-0 flex-1">
						<SheetTitle>{provider.name}</SheetTitle>
						<SheetDescription>Let your users connect {provider.name}.</SheetDescription>
					</div>
					<span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium">
						<span className={`size-1.5 rounded-full ${provider.managed ? "bg-emerald-400" : "bg-muted-foreground/40"}`} aria-hidden />
						<span className={provider.managed ? "text-emerald-400" : "text-muted-foreground"}>
							{provider.managed ? "Enabled" : "Disabled"}
						</span>
					</span>
				</div>
			</SheetHeader>

			<div className="grid flex-1 content-start gap-5 overflow-y-auto px-4 pt-1">
				{scheme === "oauth2" ? (
					<Field
						label="Callback URL"
						hint={`Register this exact URL in ${provider.name}'s OAuth settings.`}
					>
						<CopyField value={CALLBACK_URL} />
					</Field>
				) : null}

				{showScopes ? <ScopePicker key={provider.id} scopes={provider.scopes} /> : null}

				<p className="border-t border-border py-5 text-[11px] leading-5 text-muted-foreground/70">
					Provider settings aren’t configurable yet — everything runs on Runmesh-managed
					credentials. Bring-your-own OAuth apps land with provider settings.
				</p>
			</div>

			<div className="flex justify-end gap-2 border-t border-border px-4 py-4">
				<SheetClose asChild>
					<Button type="button" variant="outline">
						Close
					</Button>
				</SheetClose>
			</div>
		</>
	);
}
