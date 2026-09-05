import { useEffect, useState, useCallback } from "react";
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
import { DashboardCard } from "@/components/dashboard-card";
import {
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useConnectAppsStore } from "@/stores/connect-apps-store";
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

	// Metrics state
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

	// Fetch metrics
	useEffect(() => {
		if (!appId) return;
		const fetchMetrics = async () => {
			try {
				// Fetch grants for this app
				const grantsRes = await apiGet<any[]>(`/api/v1/connect/grants?app_id=${appId}`);
				setGrants(grantsRes.data?.length ?? 0);
				
				// Count unique users from grants
				const users = new Set(grantsRes.data?.map((g: any) => g.connect_user_id).filter(Boolean));
				setUniqueUsers(users.size);

				// Fetch tokens for this app
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
		<div className="grid gap-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="icon-sm" onClick={() => navigate("/connect")}>
						<ArrowLeftIcon className="size-4" />
					</Button>
					<div>
						<h1 className="text-xl font-semibold tracking-tight">{app?.name ?? "Connect app"}</h1>
						{app && (
							<p className="text-sm text-muted-foreground mt-1">
								{app.slug} · {app.status}
							</p>
						)}
					</div>
				</div>
			</div>

			{app && (
				<div className="grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2 lg:grid-cols-4">
					<DashboardCard>
						<CardHeader className="flex flex-row items-center justify-between">
							<CardTitle className="font-normal text-xs tracking-wide">Active grants</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-row items-center gap-2">
							<p className="font-semibold text-xl tabular-nums">{grants}</p>
						</CardContent>
						<CardFooter className="gap-1 rounded-none bg-background text-xs">
							<span className="text-muted-foreground">User authorizations</span>
						</CardFooter>
					</DashboardCard>

					<DashboardCard>
						<CardHeader className="flex flex-row items-center justify-between">
							<CardTitle className="font-normal text-xs tracking-wide">Unique users</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-row items-center gap-2">
							<p className="font-semibold text-xl tabular-nums">{uniqueUsers}</p>
						</CardContent>
						<CardFooter className="gap-1 rounded-none bg-background text-xs">
							<span className="text-muted-foreground">Connected accounts</span>
						</CardFooter>
					</DashboardCard>

					<DashboardCard>
						<CardHeader className="flex flex-row items-center justify-between">
							<CardTitle className="font-normal text-xs tracking-wide">Tokens issued</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-row items-center gap-2">
							<p className="font-semibold text-xl tabular-nums">{tokens}</p>
						</CardContent>
						<CardFooter className="gap-1 rounded-none bg-background text-xs">
							<span className="text-muted-foreground">All time</span>
						</CardFooter>
					</DashboardCard>

					<DashboardCard>
						<CardHeader className="flex flex-row items-center justify-between">
							<CardTitle className="font-normal text-xs tracking-wide">Audit events</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-row items-center gap-2">
							<p className="font-semibold text-xl tabular-nums">{total}</p>
						</CardContent>
						<CardFooter className="gap-1 rounded-none bg-background text-xs">
							<span className="text-muted-foreground">Activity log</span>
						</CardFooter>
					</DashboardCard>
				</div>
			)}

			{app && (
				<div className="grid gap-px bg-border p-px md:grid-cols-3">
					<div className="bg-background p-4">
						<div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Slug</div>
						<code className="text-sm font-mono">{app.slug}</code>
					</div>
					<div className="bg-background p-4">
						<div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Status</div>
						<div className="text-sm">{app.status}</div>
					</div>
					<div className="bg-background p-4">
						<div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Allowed providers</div>
						<div className="text-sm">{app.allowed_providers.length ? app.allowed_providers.join(", ") : "any"}</div>
					</div>
				</div>
			)}

			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold">Activity log</h2>
				<div className="flex items-center gap-3">
					<div className="relative w-64">
						<SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							placeholder="Search events..."
							className="h-9 pl-9"
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

			<div className="rounded-none border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="ps-6">Event</TableHead>
							<TableHead>Actor</TableHead>
							<TableHead>Resource</TableHead>
							<TableHead>Context</TableHead>
							<TableHead className="pe-6">Timestamp</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{loading && events.length === 0 ? (
							Array.from({ length: 5 }).map((_, i) => (
								<TableRow className="h-12" key={i}>
									<TableCell className="ps-6"><Skeleton className="h-4 w-32" /></TableCell>
									<TableCell><Skeleton className="h-4 w-24" /></TableCell>
									<TableCell><Skeleton className="h-4 w-28" /></TableCell>
									<TableCell><Skeleton className="h-4 w-20" /></TableCell>
									<TableCell className="pe-6"><Skeleton className="h-4 w-32" /></TableCell>
								</TableRow>
							))
						) : events.length === 0 ? (
							<TableRow>
								<TableCell colSpan={5} className="text-center py-12">
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
										<TableCell className="ps-6">
											<span className="text-sm font-medium">
												{cfg?.label ?? ev.event_type}
											</span>
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											<div className="flex items-center gap-1.5">
												<span>{ev.actor_type}</span>
												{ev.actor_id && (
													<code className="text-xs font-mono">{ev.actor_id.slice(0, 8)}</code>
												)}
											</div>
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{ev.resource_type ? (
												<div className="flex items-center gap-1.5">
													<span>{ev.resource_type}</span>
													{ev.resource_id && (
														<code className="text-xs font-mono">{ev.resource_id.slice(0, 8)}</code>
													)}
												</div>
											) : "—"}
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											<div className="flex flex-wrap gap-1">
												{ev.metadata.agent_id && (
													<span className="inline-flex items-center gap-1 rounded-none border border-border bg-muted px-1.5 py-0.5 text-xs font-mono">
														agent:{ev.metadata.agent_id.slice(0, 6)}
													</span>
												)}
												{ev.metadata.task_id && (
													<span className="inline-flex items-center gap-1 rounded-none border border-border bg-muted px-1.5 py-0.5 text-xs font-mono">
														task:{ev.metadata.task_id.slice(0, 6)}
													</span>
												)}
												{!ev.metadata.agent_id && !ev.metadata.task_id && "—"}
											</div>
										</TableCell>
										<TableCell className="pe-6 text-sm text-muted-foreground tabular-nums">
											{new Date(ev.created_at).toLocaleString()}
										</TableCell>
									</TableRow>
								);
							})
						)}
					</TableBody>
				</Table>
				{total > 0 && (
					<div className="flex items-center justify-between px-4 py-3 text-sm text-muted-foreground border-t border-border">
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
