import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ProvidersTable, type Provider } from "@/modules/connect/components/providers-table";
import { ProviderConfigPanel } from "@/modules/connect/components/provider-config-panel";
import { ConnectionsTable, type Connection } from "@/modules/connect/components/connections-table";
import { useConnectionsStore, type BackendConnection } from "@/lib/stores/connections-store";
import { useProvidersStore, type BackendProvider } from "@/lib/stores/providers-store";
import { useGrantsStore } from "@/lib/stores/grants-store";
import { StatCard } from "@/modules/dashboard/components/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { MagnifyingGlass, Plug } from "@phosphor-icons/react";
import EmptyState from "@/components/empty-state";

// Display names that differ from a capitalized id. Fin is Intercom's AI
// agent; the credential behind it is the Intercom workspace token.
const providerNames: Record<string, string> = {
	intercom: "Intercom Fin",
};

function toProvider(provider: BackendProvider): Provider {
	const name =
		providerNames[provider.id] ??
		provider.id.charAt(0).toUpperCase() + provider.id.slice(1);
	return {
		id: provider.id,
		name,
		slugs: [provider.id],
		extraSlugs: 0,
		auth: provider.oauth_enabled ? ["oauth2"] : ["none"],
		scopes: provider.scopes,
		managed: provider.oauth_enabled,
		lastUpdated: "—",
	};
}

function formatAge(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	if (Number.isNaN(ms) || ms < 0) return "just now";
	const minutes = Math.floor(ms / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export function ConnectPage() {
	const connections = useConnectionsStore((s) => s.connections);
	const connectionsLoading = useConnectionsStore((s) => s.loading);
	const fetchConnections = useConnectionsStore((s) => s.fetch);
	const backendProviders = useProvidersStore((s) => s.providers);
	const providersLoading = useProvidersStore((s) => s.loading);
	const fetchProviders = useProvidersStore((s) => s.fetch);
	const pendingGrants = useGrantsStore((s) => s.grants);
	const grantsLoading = useGrantsStore((s) => s.loading);
	const fetchGrants = useGrantsStore((s) => s.fetch);
	const [selected, setSelected] = useState<Provider | null>(null);
	const [query, setQuery] = useState("");

	useEffect(() => {
		fetchConnections();
	}, [fetchConnections]);

	useEffect(() => {
		fetchProviders();
	}, [fetchProviders]);

	useEffect(() => {
		fetchGrants("pending");
	}, [fetchGrants]);

	const providers = backendProviders.map(toProvider);
	const loadingProviders = providersLoading && providers.length === 0;

	const providerName = (id: string) =>
		providers.find((provider) => provider.id === id)?.name ?? id;

	const loadingStats = connectionsLoading && connections.length === 0;
	const connectedUsers = new Set(connections.map((connection) => connection.connect_user_id)).size;
	const liveProviders = new Set(connections.map((connection) => connection.provider)).size;
	const pendingCount = pendingGrants.filter((grant) => grant.status === "pending").length;

	const connectionRows: Connection[] = connections.map((connection: BackendConnection) => ({
		id: connection.id,
		user: connection.user,
		provider: providerName(connection.provider),
		account: connection.account ?? "—",
		scope: connection.scopes.join(", ") || "—",
		age: formatAge(connection.created_at),
	}));

	const filtered = providers.filter((provider) => {
		if (query) {
			const q = query.toLowerCase();
			if (!provider.name.toLowerCase().includes(q) && !provider.slugs.some((slug) => slug.includes(q))) return false;
		}
		return true;
	});

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h1 className="font-display text-[24px] font-medium tracking-[-0.025em]">Connect</h1>
				<p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
					Let your users connect the accounts your agents act on.
				</p>
			</div>

			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard label="Connected users" value={loadingStats ? "…" : String(connectedUsers)} footnote="across providers" />
				<StatCard label="Active providers" value={loadingStats ? "…" : String(liveProviders)} footnote={`of ${providers.length} available`} />
				<StatCard label="Connections" value={loadingStats ? "…" : String(connections.length)} footnote="in this workspace" />
				<StatCard label="Pending consent" value={grantsLoading && pendingGrants.length === 0 ? "…" : String(pendingCount)} footnote="awaiting users" />
			</div>

			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="space-y-1.5">
							<CardTitle>Providers</CardTitle>
							<CardDescription>Accounts your users can connect. Select one to configure.</CardDescription>
						</div>
						<div className="relative w-full max-w-xs">
							<MagnifyingGlass className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Search providers…"
								className="h-8 pl-8"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
							/>
						</div>
					</div>
				</CardHeader>
				<CardContent className="px-0">
					{loadingProviders ? (
						<div className="grid gap-2 px-4 py-2">
							{[0, 1, 2].map((index) => (
								<Skeleton className="h-14 w-full rounded-[4px]" key={index} />
							))}
						</div>
					) : filtered.length > 0 ? (
						<ProvidersTable providers={filtered} onSelect={setSelected} />
					) : (
						<div className="px-4 pb-4">
							<EmptyState
								title="No providers"
								description="The backend did not return any connect providers."
								icon={<Plug className="size-6 text-muted-foreground" />}
							/>
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<div className="space-y-1.5">
						<CardTitle>Recent connections</CardTitle>
						<CardDescription>Who has authorized which account.</CardDescription>
					</div>
				</CardHeader>
				<CardContent className="px-0">
					{connectionsLoading && connectionRows.length === 0 ? (
						<ConnectionsTable connections={[]} loading />
					) : connectionRows.length > 0 ? (
						<ConnectionsTable connections={connectionRows} />
					) : (
						<div className="px-4 pb-4">
							<EmptyState
								title="No connections yet"
								description="Connections appear here when your users connect accounts."
								icon={<Plug className="size-6 text-muted-foreground" />}
							/>
						</div>
					)}
				</CardContent>
			</Card>

			<Sheet
				open={!!selected}
				onOpenChange={(open) => {
					if (!open) setSelected(null);
				}}
			>
				<SheetContent side="right" showCloseButton={false} className="w-full sm:max-w-xl">
					{selected ? <ProviderConfigPanel key={selected.id} provider={selected} /> : null}
				</SheetContent>
			</Sheet>

		</div>
	);
}
