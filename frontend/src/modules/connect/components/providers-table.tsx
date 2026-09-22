"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { ChevronRightIcon, KeyRoundIcon, SettingsIcon } from "lucide-react";
import {
	SiGmail,
	SiGithub,
	SiGoogle,
	SiGooglecalendar,
	SiGooglesheets,
	SiMeta,
	SiNotion,
	SiSupabase,
} from "@icons-pack/react-simple-icons";

// Keyed by provider id. API ids first; legacy fixture ids kept so nothing
// regresses if they return. No `slack` entry: this pack version ships no
// Slack brand icon, so it uses the initials fallback below.
const providerIcons = {
	google: SiGoogle,
	meta: SiMeta,
	gmail: SiGmail,
	github: SiGithub,
	googlecalendar: SiGooglecalendar,
	notion: SiNotion,
	googlesheets: SiGooglesheets,
	supabase: SiSupabase,
};

export type ProviderAuth = "oauth2" | "api_key" | "dcr_oauth" | "none";

export type Provider = {
	id: string;
	name: string;
	category: string;
	slugs: string[];
	extraSlugs: number;
	auth: ProviderAuth[];
	scopes: string[];
	managed: boolean;
	lastUpdated: string;
};

const authMeta: Record<ProviderAuth, { label: string; className: string }> = {
	oauth2: { label: "OAuth2", className: "border-border text-muted-foreground" },
	api_key: { label: "API Key", className: "border-emerald-500/30 text-emerald-400" },
	dcr_oauth: { label: "DCR OAuth", className: "border-sky-500/30 text-sky-400" },
	none: { label: "No Auth", className: "border-border text-muted-foreground/60" },
};

export function AuthBadge({ auth }: { auth: ProviderAuth }) {
	const meta = authMeta[auth];
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
				meta.className
			)}
		>
			{meta.label}
		</span>
	);
}

export function ProviderLogo({ provider, size = 20 }: { provider: Provider; size?: number }) {
	const Icon = providerIcons[provider.id as keyof typeof providerIcons];
	if (Icon) {
		return <Icon aria-hidden className="shrink-0" color="default" size={size} />;
	}
	return (
		<span className="grid size-6 shrink-0 place-items-center rounded-[4px] border border-border font-mono text-[10px] uppercase text-muted-foreground">
			{provider.name.slice(0, 2)}
		</span>
	);
}

export function ProvidersTable({
	providers,
	onSelect,
}: {
	providers: Provider[];
	onSelect?: (provider: Provider) => void;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="ps-4">App</TableHead>
					<TableHead>Slugs</TableHead>
					<TableHead>Auth</TableHead>
					<TableHead>Management</TableHead>
					<TableHead>Last updated</TableHead>
					<TableHead className="pe-4" />
				</TableRow>
			</TableHeader>
			<TableBody>
				{providers.map((provider) => (
					<TableRow
						className="h-14 cursor-pointer active:bg-muted/70"
						key={provider.id}
						onClick={onSelect ? () => onSelect(provider) : undefined}
					>
						<TableCell className="ps-4">
							<span className="flex items-center gap-2.5">
								<ProviderLogo provider={provider} />
								<span className="font-medium">{provider.name}</span>
							</span>
						</TableCell>
						<TableCell>
							<span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[12px] text-muted-foreground">
								{provider.slugs.map((slug) => (
									<span key={slug}>{slug}</span>
								))}
								{provider.extraSlugs > 0 ? (
									<span className="text-muted-foreground/60">+{provider.extraSlugs}</span>
								) : null}
							</span>
						</TableCell>
						<TableCell>
							<span className="flex flex-wrap items-center gap-1.5">
								{provider.auth.map((auth) => (
									<AuthBadge key={auth} auth={auth} />
								))}
							</span>
						</TableCell>
						<TableCell>
							<span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
								<Button
									variant="ghost"
									size="icon-sm"
									className="size-6 rounded-full text-muted-foreground"
									onClick={() => onSelect?.(provider)}
								>
									<KeyRoundIcon className="size-3.5" />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									className="size-6 rounded-full text-muted-foreground"
									onClick={() => onSelect?.(provider)}
								>
									<SettingsIcon className="size-3.5" />
								</Button>
							</span>
						</TableCell>
						<TableCell className="text-[13px] text-muted-foreground">{provider.lastUpdated}</TableCell>
						<TableCell className="pe-4 text-right">
							<ChevronRightIcon className="ms-auto size-4 text-muted-foreground/60" />
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
