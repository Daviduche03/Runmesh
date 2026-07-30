"use client";

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
	{ value: null, label: "All" },
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
	const [expanded, setExpanded] = useState<string | null>(null);
	const limit = 20;

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
						<h1 className="text-xl font-semibold tracking-tight">{app?.name ?? "App"}</h1>
						{app && <p className="text-sm text-muted-foreground mt-0.5">{app.slug} · {app.status}</p>}
					</div>
				</div>
			</div>

			<div className="flex items-center gap-3">
				<div className="relative w-full max-w-sm">
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
							{auditEventTypes.find((t) => t.value === eventTypeFilter)?.label ?? "Event type"}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						{auditEventTypes.map((t) => (
							<DropdownMenuItem key={t.value ?? "all"} onClick={() => { setEventTypeFilter(t.value); setPage(1); }}>
								{t.label}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<div className="rounded-lg border border-border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="ps-6">Event</TableHead>
							<TableHead>Actor</TableHead>
							<TableHead>Resource</TableHead>
							<TableHead>Linked</TableHead>
							<TableHead className="pe-6">Timestamp</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{loading && events.length === 0 ? (
							Array.from({ length: 4 }).map((_, i) => (
								<TableRow className="h-12" key={i}>
									<TableCell className="ps-6"><Skeleton className="h-4 w-28" /></TableCell>
									<TableCell><Skeleton className="h-4 w-20" /></TableCell>
									<TableCell><Skeleton className="h-4 w-24" /></TableCell>
									<TableCell><Skeleton className="h-4 w-16" /></TableCell>
									<TableCell className="pe-6"><Skeleton className="h-4 w-20" /></TableCell>
								</TableRow>
							))
						) : events.length === 0 ? (
							<TableRow>
								<TableCell colSpan={5}>
									<EmptyState
										title="No audit events"
										description="Events will appear here as this app is used."
									/>
								</TableCell>
							</TableRow>
						) : (
							events.map((ev) => {
								const isOpen = expanded === ev.id;
								const cfg = auditEventTypes.find((t) => t.value === ev.event_type);
								return (
									<>
										<TableRow
											key={ev.id}
											className={`h-12 cursor-pointer ${isOpen ? "bg-muted/50" : ""}`}
											onClick={() => setExpanded(isOpen ? null : ev.id)}
										>
											<TableCell className="ps-6">
												<span className="text-sm font-medium text-foreground">
													{cfg?.label ?? ev.event_type}
												</span>
											</TableCell>
											<TableCell className="text-sm">
												<span className="text-muted-foreground">{ev.actor_type}</span>
												{ev.actor_id && (
													<code className="ms-1.5 text-xs font-mono text-muted-foreground">{ev.actor_id.slice(0, 8)}</code>
												)}
											</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{ev.resource_type ? (
													<>
														<span>{ev.resource_type}</span>
														<code className="ms-1.5 text-xs font-mono">{ev.resource_id?.slice(0, 8)}</code>
													</>
												) : "—"}
											</TableCell>
											<TableCell className="text-sm text-muted-foreground">
												{[
													ev.metadata.task_id && "task:" + ev.metadata.task_id.slice(0, 8),
													ev.metadata.workflow_run_id && "run:" + ev.metadata.workflow_run_id.slice(0, 8),
													ev.metadata.workspace_project_id && "ws:" + ev.metadata.workspace_project_id.slice(0, 8),
												].filter(Boolean).join(" ") || "—"}
											</TableCell>
											<TableCell className="pe-6 text-sm text-muted-foreground">
												{new Date(ev.created_at).toLocaleString()}
											</TableCell>
										</TableRow>
										{isOpen && (
											<TableRow key={`${ev.id}-details`}>
												<TableCell colSpan={5} className="bg-muted/30 px-6 py-3">
													<div className="grid grid-cols-2 gap-4 text-xs">
														<div>
															<p className="font-medium text-muted-foreground uppercase tracking-wider mb-1">Event ID</p>
															<code className="font-mono">{ev.id}</code>
														</div>
														<div>
															<p className="font-medium text-muted-foreground uppercase tracking-wider mb-1">Connect user</p>
															<code className="font-mono">{ev.connect_user_id ?? "—"}</code>
														</div>
														{Object.keys(ev.metadata ?? {}).length > 0 && (
															<div className="col-span-2">
																<p className="font-medium text-muted-foreground uppercase tracking-wider mb-1">Metadata</p>
																<pre className="font-mono text-xs text-muted-foreground bg-background border border-border p-2 max-h-32 overflow-auto">
																	{JSON.stringify(ev.metadata, null, 2)}
																</pre>
															</div>
														)}
													</div>
												</TableCell>
											</TableRow>
										)}
									</>
								);
							})
						)}
					</TableBody>
				</Table>
				{total > 0 && (
					<div className="flex items-center justify-between px-4 py-3 text-sm text-muted-foreground border-t border-border">
						<span>Showing {events.length} of {total} events</span>
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
