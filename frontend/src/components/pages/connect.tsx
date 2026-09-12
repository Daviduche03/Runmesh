import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConnectAppsStore, type ConnectApp } from "@/stores/connect-apps-store";
import { apiGet } from "@/lib/api";
import EmptyState from "@/components/empty-state";
import {
	PlusIcon, Trash2Icon, CopyIcon, Loader2Icon, MoreVerticalIcon, BarChart3Icon,
} from "lucide-react";
import { Bar, BarChart, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
	return (
		<div className="bg-background p-5">
			<dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
			<dd className="mt-2 text-[26px] font-medium leading-none tabular-nums">{value}</dd>
			{sub ? <div className="mt-2 text-[12px] text-muted-foreground">{sub}</div> : null}
		</div>
	);
}

function Panel({
	title,
	aside,
	children,
}: {
	title: string;
	aside?: string;
	children: ReactNode;
}) {
	return (
		<div className="border border-border bg-background">
			<div className="flex items-baseline justify-between border-b border-border px-5 py-3">
				<h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{title}</h3>
				{aside ? <span className="text-[12px] text-muted-foreground">{aside}</span> : null}
			</div>
			<div className="p-5">{children}</div>
		</div>
	);
}

function ConnectAppsTable({ apps, loading, onDelete }: {
	apps: ConnectApp[];
	loading: boolean;
	onDelete: (id: string, name: string) => void;
}) {
	const navigate = useNavigate();

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="ps-5">Name</TableHead>
					<TableHead>Slug</TableHead>
					<TableHead>Providers</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Created</TableHead>
					<TableHead className="pe-5 text-right">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{loading ? (
					Array.from({ length: 3 }).map((_, i) => (
						<TableRow className="h-12" key={i}>
							<TableCell className="ps-5"><Skeleton className="h-4 w-24" /></TableCell>
							<TableCell><Skeleton className="h-4 w-20" /></TableCell>
							<TableCell><Skeleton className="h-4 w-16" /></TableCell>
							<TableCell><Skeleton className="h-4 w-12" /></TableCell>
							<TableCell><Skeleton className="h-4 w-20" /></TableCell>
							<TableCell className="pe-5"><Skeleton className="ms-auto h-4 w-8" /></TableCell>
						</TableRow>
					))
				) : apps.length === 0 ? null : (
					apps.map((app) => (
						<TableRow
							className="h-12 cursor-pointer"
							key={app.id}
							onClick={() => navigate(`/connect/apps/${app.id}`)}
						>
							<TableCell className="ps-5 font-medium">{app.name}</TableCell>
							<TableCell className="font-mono text-[13px] text-muted-foreground">{app.slug}</TableCell>
							<TableCell className="text-[13px] text-muted-foreground">
								{app.allowed_providers.length ? app.allowed_providers.join(", ") : "any"}
							</TableCell>
							<TableCell className="text-[13px]">{app.status}</TableCell>
							<TableCell className="text-[13px] text-muted-foreground">
								{app.created_at ? new Date(app.created_at).toLocaleDateString() : "—"}
							</TableCell>
							<TableCell className="pe-5 text-right" onClick={(e) => e.stopPropagation()}>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon-sm">
											<MoreVerticalIcon className="size-4" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onClick={() => navigator.clipboard.writeText(app.id)}>
											<CopyIcon className="me-2 size-3.5" />
											Copy ID
										</DropdownMenuItem>
										<DropdownMenuItem
											className="text-destructive focus:text-destructive"
											onClick={() => onDelete(app.id, app.name)}
										>
											<Trash2Icon className="me-2 size-3.5" />
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</TableCell>
						</TableRow>
					))
				)}
			</TableBody>
		</Table>
	);
}

export function ConnectPage() {
	const connectApps = useConnectAppsStore();
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

	const [cName, setCName] = useState("");
	const [cSlug, setCSlug] = useState("");
	const [cRedirectUri, setCRedirectUri] = useState("");
	const [cProviders, setCProviders] = useState("google");
	const [cError, setCError] = useState("");

	const [pendingApprovals, setPendingApprovals] = useState<number>(0);
	const [tokenRequests24h, setTokenRequests24h] = useState<number>(0);
	const [metrics, setMetrics] = useState<Record<string, number>>({});
	const [latencyP99, setLatencyP99] = useState<number>(0);

	useEffect(() => {
		connectApps.fetch();
		const fetchMetrics = async () => {
			try {
				const res = await apiGet<{ pending_approvals: number; token_requests_24h: number; metrics: Record<string, number>; latency_p99_ms: number }>("/api/v1/connect/metrics");
				if (res.data) {
					setPendingApprovals(res.data.pending_approvals);
					setTokenRequests24h(res.data.token_requests_24h);
					setMetrics(res.data.metrics || {});
					setLatencyP99(res.data.latency_p99_ms || 0);
				}
			} catch {
				// ignore
			}
		};
		void fetchMetrics();
	}, []);

	const handleCreate = async (e: React.FormEvent) => {
		e.preventDefault();
		setCError("");
		if (!cName.trim() || !cSlug.trim() || !cRedirectUri.trim()) {
			setCError("Name, slug, and redirect URI are required");
			return;
		}
		const ok = await connectApps.create({
			name: cName.trim(),
			slug: cSlug.trim(),
			redirect_uris: [cRedirectUri.trim()],
			allowed_providers: cProviders ? [cProviders] : [],
		});
		if (ok) {
			setShowCreateModal(false);
			setCName("");
			setCSlug("");
			setCRedirectUri("");
			setCProviders("google");
		} else {
			setCError("Failed to create app");
		}
	};

	const handleDelete = async () => {
		if (!deleteTarget) return;
		const ok = await connectApps.remove(deleteTarget.id);
		if (ok) setDeleteTarget(null);
	};

	const totalGrants = Object.values(connectApps.grantsByApp).reduce((sum, g) => sum + g.length, 0);
	const blockedKeys = Object.keys(metrics).filter((k) => k.startsWith("token_blocked_"));

	return (
		<div className="grid gap-8">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="font-display text-[22px] font-medium tracking-[-0.02em]">Connect</h1>
					<p className="mt-1 max-w-2xl text-[14px] leading-6 text-muted-foreground">
						Register OAuth apps so users can sign in with Runmesh Connect and grant scoped, auditable access
						to the services you build.
					</p>
				</div>
				<Button onClick={() => setShowCreateModal(true)}>
					<PlusIcon className="me-1.5 size-4" />
					Create app
				</Button>
			</div>

			<dl className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
				<Stat label="Registered apps" value={connectApps.loading ? "…" : connectApps.apps.length} sub="OAuth 2.0" />
				<Stat label="Active grants" value={totalGrants} sub="User authorizations" />
				<Stat label="Pending approvals" value={pendingApprovals} sub="Awaiting review" />
				<Stat label="Token requests" value={tokenRequests24h} sub="Last 24 hours" />
			</dl>

			<div className="grid gap-px border border-border bg-border lg:grid-cols-2">
				<Panel title="Blocked requests" aside="by reason">
					{blockedKeys.length === 0 ? (
						<div className="flex h-40 items-center justify-center">
							<div className="text-center">
								<BarChart3Icon className="mx-auto size-5 text-muted-foreground" />
								<p className="mt-2 text-[13px] text-muted-foreground">No blocks yet</p>
							</div>
						</div>
					) : (
						<ChartContainer config={{ count: { label: "Blocked", color: "var(--chart-1)" } } satisfies ChartConfig} className="h-40 w-full">
							<BarChart accessibilityLayer data={[
								{ reason: "pending", count: metrics["token_blocked_pending"] || 0 },
								{ reason: "denied", count: metrics["token_blocked_denied"] || 0 },
								{ reason: "expired", count: metrics["token_blocked_expired"] || 0 },
								{ reason: "exhausted", count: metrics["token_blocked_exhausted"] || 0 },
								{ reason: "not yet", count: metrics["token_blocked_not_yet_valid"] || 0 },
							]}>
								<XAxis dataKey="reason" tickLine={false} axisLine={false} tickMargin={8} />
								<ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={false} />
								<Bar dataKey="count" fill="var(--color-count)" radius={2} />
							</BarChart>
						</ChartContainer>
					)}
				</Panel>

				<Panel title="Token latency" aside={latencyP99 ? `${latencyP99}ms p99` : "p99"}>
					{!latencyP99 ? (
						<div className="flex h-40 items-center justify-center">
							<div className="text-center">
								<BarChart3Icon className="mx-auto size-5 text-muted-foreground" />
								<p className="mt-2 text-[13px] text-muted-foreground">No requests yet</p>
							</div>
						</div>
					) : (
						<ChartContainer config={{ latency: { label: "Latency", color: "var(--chart-2)" } } satisfies ChartConfig} className="h-40 w-full">
							<BarChart accessibilityLayer data={[{ name: "p99", latency: latencyP99 }]}>
								<XAxis dataKey="name" tickLine={false} axisLine={false} />
								<ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={false} />
								<Bar dataKey="latency" fill="var(--color-latency)" radius={2} />
							</BarChart>
						</ChartContainer>
					)}
				</Panel>
			</div>

			<div className="border border-border bg-background">
				<div className="flex items-center justify-between border-b border-border px-5 py-3">
					<h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Registered apps</h2>
					{connectApps.apps.length > 0 ? (
						<span className="text-[12px] text-muted-foreground">{connectApps.apps.length} total</span>
					) : null}
				</div>
				{connectApps.loading && connectApps.apps.length === 0 ? (
					<div className="flex items-center justify-center py-16">
						<Loader2Icon className="size-6 animate-spin text-muted-foreground" />
					</div>
				) : connectApps.apps.length === 0 ? (
					<div>
						<EmptyState
							title="No Connect apps"
							description="Register an app to start issuing scoped, auditable access tokens for your users."
						/>
						<div className="flex justify-center pb-6">
							<Button variant="outline" size="sm" onClick={() => setShowCreateModal(true)}>
								<PlusIcon className="me-1.5 size-3.5" />
								Create app
							</Button>
						</div>
					</div>
				) : (
					<ConnectAppsTable
						apps={connectApps.apps}
						loading={connectApps.loading}
						onDelete={(id, name) => setDeleteTarget({ id, name })}
					/>
				)}
			</div>

			<Modal open={showCreateModal} onClose={() => { setShowCreateModal(false); setCError(""); }} title="Create Connect app">
				<form onSubmit={handleCreate} className="grid gap-5">
					<div className="grid gap-1.5">
						<label className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Name</label>
						<Input placeholder="e.g. TaskFlow" value={cName} onChange={(e) => setCName(e.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<label className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Slug</label>
						<Input placeholder="e.g. taskflow" value={cSlug} onChange={(e) => setCSlug(e.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<label className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Redirect URI</label>
						<Input placeholder="e.g. https://taskflow.io/auth/callback" value={cRedirectUri} onChange={(e) => setCRedirectUri(e.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<label className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">Allowed provider</label>
						<select
							className="flex h-9 w-full rounded-[4px] border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							value={cProviders}
							onChange={(e) => setCProviders(e.target.value)}
						>
							<option value="google">Google</option>
							<option value="">Any (user selects at runtime)</option>
						</select>
					</div>
					{cError && <p className="text-sm text-destructive">{cError}</p>}
					<div className="flex justify-end gap-3 border-t border-border pt-4">
						<Button type="button" variant="outline" onClick={() => { setShowCreateModal(false); setCError(""); }}>Cancel</Button>
						<Button type="submit" disabled={connectApps.creating}>
							{connectApps.creating && <Loader2Icon className="me-1.5 size-4 animate-spin" />}
							Create app
						</Button>
					</div>
				</form>
			</Modal>

			<Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Connect app">
				<div className="grid gap-5">
					<p className="text-sm leading-6 text-muted-foreground">
						Are you sure you want to delete <span className="font-medium text-foreground">{deleteTarget?.name}</span>?
						All grants and active sessions for this app will be revoked.
					</p>
					<div className="flex justify-end gap-3 border-t border-border pt-4">
						<Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
						<Button variant="destructive" onClick={handleDelete} disabled={connectApps.deleting}>
							{connectApps.deleting && <Loader2Icon className="me-1.5 size-4 animate-spin" />}
							Delete
						</Button>
					</div>
				</div>
			</Modal>
		</div>
	);
}
