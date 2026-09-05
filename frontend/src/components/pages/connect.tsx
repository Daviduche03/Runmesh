import { useEffect, useState } from "react";
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
import { DashboardCard } from "@/components/dashboard-card";
import {
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useConnectAppsStore, type ConnectApp } from "@/stores/connect-apps-store";
import { apiGet } from "@/lib/api";
import EmptyState from "@/components/empty-state";
import {
	PlusIcon, Trash2Icon, CopyIcon, Loader2Icon, MoreVerticalIcon, BarChart3Icon,
} from "lucide-react";
import { Bar, BarChart, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { CardDescription } from "@/components/ui/card";

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
					<TableHead className="ps-6">Name</TableHead>
					<TableHead>Slug</TableHead>
					<TableHead>Providers</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Created</TableHead>
					<TableHead className="pe-6 text-right">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{loading ? (
					Array.from({ length: 3 }).map((_, i) => (
						<TableRow className="h-12" key={i}>
							<TableCell className="ps-6"><Skeleton className="h-4 w-24" /></TableCell>
							<TableCell><Skeleton className="h-4 w-20" /></TableCell>
							<TableCell><Skeleton className="h-4 w-16" /></TableCell>
							<TableCell><Skeleton className="h-4 w-12" /></TableCell>
							<TableCell><Skeleton className="h-4 w-20" /></TableCell>
							<TableCell className="pe-6"><Skeleton className="h-4 w-8 ms-auto" /></TableCell>
						</TableRow>
					))
				) : apps.length === 0 ? null : (
					apps.map((app) => (
						<TableRow 
							className="h-12 cursor-pointer" 
							key={app.id}
							onClick={() => navigate(`/connect/apps/${app.id}`)}
						>
							<TableCell className="ps-6 font-medium">
								{app.name}
							</TableCell>
							<TableCell className="text-muted-foreground text-sm font-mono">{app.slug}</TableCell>
							<TableCell className="text-muted-foreground text-sm">
								{app.allowed_providers.length ? app.allowed_providers.join(", ") : "any"}
							</TableCell>
							<TableCell className="text-sm">{app.status}</TableCell>
							<TableCell className="text-muted-foreground text-sm">
								{app.created_at ? new Date(app.created_at).toLocaleDateString() : "—"}
							</TableCell>
							<TableCell className="pe-6 text-right" onClick={(e) => e.stopPropagation()}>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon-sm">
											<MoreVerticalIcon className="size-4" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onClick={() => {
											navigator.clipboard.writeText(app.id);
										}}>
											<CopyIcon className="size-3.5 me-2" />
											Copy ID
										</DropdownMenuItem>
										<DropdownMenuItem 
											className="text-red-400 focus:text-red-400"
											onClick={() => onDelete(app.id, app.name)}
										>
											<Trash2Icon className="size-3.5 me-2" />
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

	// Metrics state
	const [metrics, setMetrics] = useState<Record<string, number>>({});
	const [latencyP99, setLatencyP99] = useState<number>(0);

	useEffect(() => {
		connectApps.fetch();
		// Fetch metrics
		const fetchMetrics = async () => {
			try {
				const res = await apiGet<{ pending_approvals: number; token_requests_24h: number; metrics: Record<string, number>; latency_p99_ms: number }>("/api/v1/connect/metrics");
				if (res.data) {
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

	return (
		<div className="grid gap-8">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Connect</h1>
					<p className="text-sm text-muted-foreground mt-1">
						Manage OAuth apps that issue scoped, auditable access for agents acting on behalf of users.
					</p>
				</div>
				<Button onClick={() => setShowCreateModal(true)}>
					<PlusIcon className="size-4 me-1.5" />
					Create app
				</Button>
			</div>

			<div className="grid grid-cols-1 gap-px bg-border p-px md:grid-cols-2 lg:grid-cols-4">
				<DashboardCard>
					<CardHeader className="flex flex-row items-center justify-between">
						<CardTitle className="font-normal text-xs tracking-wide">Registered apps</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-row items-center gap-2">
						<p className="font-semibold text-xl tabular-nums">{connectApps.loading ? "..." : connectApps.apps.length}</p>
					</CardContent>
					<CardFooter className="gap-1 rounded-none bg-background text-xs">
						<span className="text-muted-foreground">OAuth 2.0 enabled</span>
					</CardFooter>
				</DashboardCard>

				<DashboardCard>
					<CardHeader className="flex flex-row items-center justify-between">
						<CardTitle className="font-normal text-xs tracking-wide">Active grants</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-row items-center gap-2">
						<p className="font-semibold text-xl tabular-nums">{totalGrants}</p>
					</CardContent>
					<CardFooter className="gap-1 rounded-none bg-background text-xs">
						<span className="text-muted-foreground">User authorizations</span>
					</CardFooter>
				</DashboardCard>

				<DashboardCard className="gap-0">
					<CardHeader className="gap-2">
						<CardTitle>Blocked breakdown</CardTitle>
						<CardDescription>Token requests blocked by reason, last isolate.</CardDescription>
					</CardHeader>
					<CardContent>
						{Object.keys(metrics).filter(k => k.startsWith("token_blocked_")).length === 0 ? (
							<div className="flex h-40 items-center justify-center">
								<div className="text-center">
									<BarChart3Icon className="mx-auto size-5 text-muted-foreground" />
									<p className="mt-2 text-sm text-muted-foreground">No blocks yet</p>
								</div>
							</div>
						) : (
							<ChartContainer config={{ count: { label: "Blocked", color: "var(--chart-1)" } } satisfies ChartConfig} className="h-40 w-full">
								<BarChart accessibilityLayer data={[
									{ reason: "pending", count: metrics["token_blocked_pending"] || 0 },
									{ reason: "denied", count: metrics["token_blocked_denied"] || 0 },
									{ reason: "expired", count: metrics["token_blocked_expired"] || 0 },
									{ reason: "exhausted", count: metrics["token_blocked_exhausted"] || 0 },
									{ reason: "not_yet", count: metrics["token_blocked_not_yet_valid"] || 0 },
								]}>
									<XAxis dataKey="reason" tickLine={false} axisLine={false} tickMargin={8} />
									<ChartTooltip content={<ChartTooltipContent hideLabel />} cursor={false} />
									<Bar dataKey="count" fill="var(--color-count)" radius={2} />
								</BarChart>
							</ChartContainer>
						)}
					</CardContent>
				</DashboardCard>

				<DashboardCard className="gap-0">
					<CardHeader className="gap-2">
						<CardTitle>Token latency</CardTitle>
						<CardDescription>p99 token exchange latency.</CardDescription>
					</CardHeader>
					<CardContent>
						{!latencyP99 ? (
							<div className="flex h-40 items-center justify-center">
								<div className="text-center">
									<BarChart3Icon className="mx-auto size-5 text-muted-foreground" />
									<p className="mt-2 text-sm text-muted-foreground">No requests yet</p>
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
					</CardContent>
					<CardFooter className="gap-1 rounded-none bg-background text-xs">
						<span className="text-muted-foreground">{latencyP99 ? `${latencyP99}ms p99` : "Token exchange"}</span>
					</CardFooter>
				</DashboardCard>
			</div>

			<div className="rounded-none border border-border">
				<div className="px-5 py-4 border-b border-border">
					<h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">Registered apps</h2>
				</div>
				{connectApps.loading && connectApps.apps.length === 0 ? (
					<div className="py-16 flex items-center justify-center">
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
								<PlusIcon className="size-3.5 me-1.5" />
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
						<label className="text-sm font-medium">Name</label>
						<Input placeholder="e.g. TaskFlow" value={cName} onChange={(e) => setCName(e.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Slug</label>
						<Input placeholder="e.g. taskflow" value={cSlug} onChange={(e) => setCSlug(e.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Redirect URI</label>
						<Input placeholder="e.g. https://taskflow.io/auth/callback" value={cRedirectUri} onChange={(e) => setCRedirectUri(e.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Allowed provider</label>
						<select
							className="flex h-9 w-full rounded-none border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							value={cProviders}
							onChange={(e) => setCProviders(e.target.value)}
						>
							<option value="google">Google</option>
							<option value="">Any (user selects at runtime)</option>
						</select>
					</div>
					{cError && <p className="text-sm text-red-400">{cError}</p>}
					<div className="flex justify-end gap-3 pt-2 border-t border-border">
						<Button type="button" variant="outline" onClick={() => { setShowCreateModal(false); setCError(""); }}>Cancel</Button>
						<Button type="submit" disabled={connectApps.creating}>
							{connectApps.creating && <Loader2Icon className="size-4 animate-spin me-1.5" />}
							Create app
						</Button>
					</div>
				</form>
			</Modal>

			<Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Connect app">
				<div className="grid gap-5">
					<p className="text-sm text-muted-foreground">
						Are you sure you want to delete <span className="font-medium text-foreground">{deleteTarget?.name}</span>?
						All grants and active sessions for this app will be revoked.
					</p>
					<div className="flex justify-end gap-3 pt-2 border-t border-border">
						<Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
						<Button variant="destructive" onClick={handleDelete} disabled={connectApps.deleting}>
							{connectApps.deleting && <Loader2Icon className="size-4 animate-spin me-1.5" />}
							Delete
						</Button>
					</div>
				</div>
			</Modal>
		</div>
	);
}