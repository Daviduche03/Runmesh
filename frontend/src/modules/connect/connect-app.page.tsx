import { useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useConnectAppsStore } from "@/lib/stores/connect-apps-store";
import { apiGet } from "@/lib/api";
import EmptyState from "@/components/empty-state";
import { ArrowLeftIcon, SearchIcon, FilterIcon } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type AuditEvent = {
	id: string;
	event_type: string;
	actor_type: string;
	actor_id: string | null;
	connect_app_id: string | null;
	connect_user_id: string | null;
	resource_type: string | null;
	resource_id: string | null;
	metadata: Record<string, string>;
	created_at: string;
};

const auditEventTypes = [
	{ value: null, label: "All events" },
	{ value: "connect.app.created", label: "App created" },
	{ value: "connect.session.created", label: "Session created" },
	{ value: "connect.connection.created", label: "Connection created" },
	{ value: "connect.grant.approved", label: "Grant approved" },
	{ value: "connect.grant.denied", label: "Grant denied" },
	{ value: "connect.token.exchanged", label: "Token exchanged" },
] as const;

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
	return (
		<div className="bg-background p-5">
			<dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
			<dd className="mt-2 text-[26px] font-medium leading-none tabular-nums">{value}</dd>
			{sub ? <div className="mt-2 text-[12px] text-muted-foreground">{sub}</div> : null}
		</div>
	);
}

export function ConnectAppPage() {
	const { appId } = useParams<{ appId: string }>();
	const navigate = useNavigate();
	const store = useConnectAppsStore();
	const app = store.apps.find((a) => a.id === appId);

	const [events, setEvents] = useState<AuditEvent[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [eventTypeFilter, setEventTypeFilter] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(1);
	const limit = 20;

	const [grants, setGrants] = useState(0);
	const [tokens, setTokens] = useState(0);
	const [uniqueUsers, setUniqueUsers] = useState(0);

	useEffect(() => {
		if (!store.apps.length) store.fetch();
	}, []);

	const fetch = useCallback(async () => {
		if (!appId) return;
		setLoading(true);
		try {
			const params = new URLSearchParams();
			params.set("app_id", appId);
			if (eventTypeFilter) params.set("event_type", eventTypeFilter);
			if (search.trim()) params.set("search", search.trim());
			params.set("limit", String(limit));
			params.set("offset", String((page - 1) * limit));
			const res = await apiGet<AuditEvent[]>(`/api/v1/connect/audit?${params}`);
			setEvents(res.data ?? []);
			setTotal(res.meta?.total ?? 0);
		} catch {
			setEvents([]);
			setTotal(0);
		} finally {
			setLoading(false);
		}
	}, [appId, eventTypeFilter, search, page]);

	useEffect(() => { void fetch(); }, [fetch]);

	useEffect(() => {
		if (!appId) return;
		const fetchMetrics = async () => {
			try {
				const grantsRes = await apiGet<any[]>(`/api/v1/connect/grants?app_id=${appId}`);
				setGrants(grantsRes.data?.length ?? 0);
				const users = new Set(grantsRes.data?.map((g: any) => g.connect_user_id).filter(Boolean));
				setUniqueUsers(users.size);
				const tokensRes = await apiGet<any[]>(`/api/v1/connect/tokens?app_id=${appId}`);
				setTokens(tokensRes.data?.length ?? 0);
			} catch {
				// ignore
			}
		};
		void fetchMetrics();
	}, [appId]);

	const totalPages = Math.ceil(total / limit);

	if (!appId) return null;

	return (
		<div className="grid gap-6">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="icon-sm" onClick={() => navigate("/connect")} aria-label="Back to Connect">
						<ArrowLeftIcon className="size-4" />
					</Button>
					<div>
						<h1 className="font-display text-[22px] font-medium tracking-[-0.02em]">{app?.name ?? "Connect app"}</h1>
						{app && (
							<p className="mt-1 font-mono text-[12px] text-muted-foreground">
								{app.slug} · {app.status}
							</p>
						)}
					</div>
				</div>
			</div>

			{app && (
				<dl className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
					<Stat label="Active grants" value={grants} sub="User authorizations" />
					<Stat label="Unique users" value={uniqueUsers} sub="Connected accounts" />
					<Stat label="Tokens issued" value={tokens} sub="All time" />
					<Stat label="Audit events" value={total} sub="Activity log" />
				</dl>
			)}

			{app && (
				<div className="border border-border bg-background">
					<div className="border-b border-border px-5 py-3">
						<h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Application</h2>
					</div>
					<dl className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
						<div className="bg-background p-5">
							<dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Slug</dt>
							<dd className="mt-1.5 font-mono text-[13px]">{app.slug}</dd>
						</div>
						<div className="bg-background p-5">
							<dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Status</dt>
							<dd className="mt-1.5 text-[13px]">{app.status}</dd>
						</div>
						<div className="bg-background p-5">
							<dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Allowed providers</dt>
							<dd className="mt-1.5 text-[13px]">
								{app.allowed_providers.length ? app.allowed_providers.join(", ") : "any"}
							</dd>
						</div>
						<div className="bg-background p-5">
							<dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Created</dt>
							<dd className="mt-1.5 text-[13px]">
								{app.created_at ? new Date(app.created_at).toLocaleDateString() : "—"}
							</dd>
						</div>
					</dl>
				</div>
			)}

			<div className="border border-border bg-background">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
					<h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Activity log</h2>
					<div className="flex items-center gap-3">
						<div className="relative w-56">
							<SearchIcon className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Search events..."
								className="h-8 pl-8 text-[13px]"
								value={search}
								onChange={(e) => { setSearch(e.target.value); setPage(1); }}
							/>
						</div>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" size="sm" className="gap-2">
									<FilterIcon className="size-3.5" />
									{auditEventTypes.find((t) => t.value === eventTypeFilter)?.label ?? "All events"}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{auditEventTypes.map((t) => (
									<DropdownMenuItem key={t.value ?? "all"} onClick={() => { setEventTypeFilter(t.value); setPage(1); }}>
										{t.label}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>

				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="ps-5">Event</TableHead>
							<TableHead>Actor</TableHead>
							<TableHead>Resource</TableHead>
							<TableHead>Context</TableHead>
							<TableHead className="pe-5">Timestamp</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{loading && events.length === 0 ? (
							Array.from({ length: 5 }).map((_, i) => (
								<TableRow className="h-12" key={i}>
									<TableCell className="ps-5"><Skeleton className="h-4 w-32" /></TableCell>
									<TableCell><Skeleton className="h-4 w-24" /></TableCell>
									<TableCell><Skeleton className="h-4 w-28" /></TableCell>
									<TableCell><Skeleton className="h-4 w-20" /></TableCell>
									<TableCell className="pe-5"><Skeleton className="h-4 w-32" /></TableCell>
								</TableRow>
							))
						) : events.length === 0 ? (
							<TableRow>
								<TableCell colSpan={5} className="py-12 text-center">
									<EmptyState
										title="No events found"
										description={search || eventTypeFilter ? "Try adjusting your filters" : "Activity will appear here as the app is used"}
									/>
								</TableCell>
							</TableRow>
						) : (
							events.map((ev) => {
								const cfg = auditEventTypes.find((t) => t.value === ev.event_type);
								return (
									<TableRow key={ev.id} className="h-12">
										<TableCell className="ps-5">
											<span className="text-[13px] font-medium">{cfg?.label ?? ev.event_type}</span>
										</TableCell>
										<TableCell className="text-[13px] text-muted-foreground">
											<div className="flex items-center gap-1.5">
												<span>{ev.actor_type}</span>
												{ev.actor_id && <code className="font-mono text-[11px]">{ev.actor_id.slice(0, 8)}</code>}
											</div>
										</TableCell>
										<TableCell className="text-[13px] text-muted-foreground">
											{ev.resource_type ? (
												<div className="flex items-center gap-1.5">
													<span>{ev.resource_type}</span>
													{ev.resource_id && <code className="font-mono text-[11px]">{ev.resource_id.slice(0, 8)}</code>}
												</div>
											) : "—"}
										</TableCell>
										<TableCell className="text-[13px] text-muted-foreground">
											<div className="flex flex-wrap gap-1">
												{ev.metadata.agent_id && (
													<span className="inline-flex items-center gap-1 rounded-[3px] border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
														agent:{ev.metadata.agent_id.slice(0, 6)}
													</span>
												)}
												{ev.metadata.task_id && (
													<span className="inline-flex items-center gap-1 rounded-[3px] border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
														task:{ev.metadata.task_id.slice(0, 6)}
													</span>
												)}
												{!ev.metadata.agent_id && !ev.metadata.task_id && "—"}
											</div>
										</TableCell>
										<TableCell className="pe-5 text-[13px] tabular-nums text-muted-foreground">
											{new Date(ev.created_at).toLocaleString()}
										</TableCell>
									</TableRow>
								);
							})
						)}
					</TableBody>
				</Table>

				{total > 0 && (
					<div className="flex items-center justify-between border-t border-border px-5 py-3 text-[13px] text-muted-foreground">
						<span>
							{events.length === 0 ? "No events" : `${((page - 1) * limit) + 1}–${Math.min(page * limit, total)} of ${total}`}
						</span>
						<div className="flex gap-2">
							<Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
								Previous
							</Button>
							<Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
								Next
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
