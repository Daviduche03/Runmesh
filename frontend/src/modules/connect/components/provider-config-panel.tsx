"use client";

import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AuthBadge, ProviderLogo, type Provider, type ProviderAuth } from "@/modules/connect/components/providers-table";
import { CheckIcon, CopyIcon } from "lucide-react";

const CALLBACK_URL = "https://connect.runmesh.app/oauth/callback";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<section className="grid gap-3 border-t border-border py-5 first:border-t-0 first:pt-0">
			<div className="flex items-baseline justify-between gap-3">
				<h3 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
				{hint ? <span className="text-[11px] text-muted-foreground/70">{hint}</span> : null}
			</div>
			<div className="grid gap-3">{children}</div>
		</section>
	);
}

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
				{copied ? <CheckIcon className="size-3.5 text-emerald-400" /> : <CopyIcon className="size-3.5" />}
			</button>
		</div>
	);
}

function SchemeDescription({ provider, scheme }: { provider: Provider; scheme: ProviderAuth }) {
	if (scheme === "oauth2") {
		return (
			<p className="text-[12px] leading-5 text-muted-foreground">
				Runmesh maintains the OAuth app for {provider.name}. Zero setup — your users see
				“Runmesh” on the consent screen.
			</p>
		);
	}
	if (scheme === "api_key") {
		return (
			<p className="text-[12px] leading-5 text-muted-foreground">
				Uses a per-connection API key, stored encrypted and sent on each request.
			</p>
		);
	}
	if (scheme === "dcr_oauth") {
		return (
			<p className="text-[12px] leading-5 text-muted-foreground">
				{provider.name} supports dynamic client registration. Runmesh registers a client
				automatically — there are no credentials to provide.
			</p>
		);
	}
	return (
		<p className="text-[12px] leading-5 text-muted-foreground">
			{provider.name} requires no authentication.
		</p>
	);
}

export function ProviderConfigPanel({ provider }: { provider: Provider }) {
	const scheme = provider.auth[0] ?? "none";
	const showScopes = (scheme === "oauth2" || scheme === "dcr_oauth") && provider.scopes.length > 0;

	return (
		<>
			<SheetHeader>
				<div className="flex items-start gap-3">
					<span className="mt-0.5">
						<ProviderLogo provider={provider} size={24} />
					</span>
					<div className="min-w-0 flex-1">
						<SheetTitle className="flex flex-wrap items-center gap-2">
							{provider.name}
							<span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
								{provider.category}
							</span>
						</SheetTitle>
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

			<div className="flex-1 overflow-y-auto px-4">
				<Section title="Authentication">
					<div className="flex flex-wrap gap-1.5">
						{provider.auth.map((auth) => (
							<AuthBadge key={auth} auth={auth} />
						))}
					</div>
					<SchemeDescription provider={provider} scheme={scheme} />

					{scheme === "oauth2" ? (
						<Field
							label="Callback URL"
							hint={`Register this exact URL in ${provider.name}'s OAuth settings.`}
						>
							<CopyField value={CALLBACK_URL} />
						</Field>
					) : null}

					{showScopes ? (
						<Field label="Scopes" hint="Requested from every new connection.">
							<ul className="grid gap-1.5">
								{provider.scopes.map((scope) => (
									<li key={scope} className="font-mono text-[12.5px]">
										{scope}
									</li>
								))}
							</ul>
						</Field>
					) : null}
				</Section>

				<Section title="Tools" hint={`${provider.slugs.length} available`}>
					<ul className="grid gap-1.5">
						{provider.slugs.map((slug) => (
							<li key={slug} className="font-mono text-[12.5px]">
								{slug}
							</li>
						))}
					</ul>
				</Section>

				<p className="border-t border-border py-5 text-[11px] leading-5 text-muted-foreground/70">
					Provider settings aren’t configurable yet — everything runs on Runmesh-managed
					credentials. Bring-your-own OAuth apps land with provider settings.
				</p>
			</div>
		</>
	);
}
