"use client";

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
import { useConnectAppsStore, type ConnectApp } from "@/stores/connect-apps-store";
import { apiGet } from "@/lib/api";
import EmptyState from "@/components/empty-state";
import {
	ShieldCheckIcon, PlusIcon, Trash2Icon, CheckIcon, CopyIcon,
	Loader2Icon, UsersIcon, KeyRoundIcon, GitBranchIcon, Grid3X3Icon,
} from "lucide-react";

const tabs = [
	{ id: "apps", label: "Apps", icon: <ShieldCheckIcon className="size-4" /> },
	{ id: "providers", label: "Providers", icon: <Grid3X3Icon className="size-4" /> },
] as const;

function ConnectAppsTable({ apps, loading, onDelete }: {
	apps: ConnectApp[];
	loading: boolean;
	onDelete: (id: string, name: string) => void;
}) {
	const navigate = useNavigate();
	const [copied, setCopied] = useState<string | null>(null);

	const copyValue = (key: string, value: string) => {
		navigator.clipboard.writeText(value);
		setCopied(key);
		setTimeout(() => setCopied(null), 2000);
	};

	return (
		<div className="rounded-lg border border-border">
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
							<TableRow className="h-12" key={app.id}>
								<TableCell className="ps-6">
									<button className="font-medium text-sm hover:text-emerald-400 transition-colors" onClick={() => navigate(`/connect/apps/${app.id}`)}>
										{app.name}
									</button>
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
									<div className="flex items-center justify-end gap-1">
										<Button variant="ghost" size="icon-sm" onClick={() => copyValue(`id-${app.id}`, app.id)}>
											{copied === `id-${app.id}` ? <CheckIcon className="size-3.5 text-emerald-400" /> : <CopyIcon className="size-3.5" />}
										</Button>
										<Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-red-400" onClick={() => onDelete(app.id, app.name)}>
											<Trash2Icon className="size-3.5" />
										</Button>
									</div>
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</div>
	);
}

type Provider = {
	id: string;
	scopes: string[];
	oauth_enabled: boolean;
};

function ProvidersTab() {
	const [providers, setProviders] = useState<Provider[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const fetchProviders = async () => {
			setLoading(true);
			try {
				const { data } = await apiGet<Provider[]>("/api/v1/connect/providers");
				setProviders(data ?? []);
			} catch {
				setProviders([]);
			} finally {
				setLoading(false);
			}
		};
		void fetchProviders();
	}, []);

	if (loading) {
		return (
			<div className="py-16 flex items-center justify-center">
				<Loader2Icon className="size-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="grid gap-4">
			{providers.map((p) => (
				<div key={p.id} className="rounded-lg border border-border">
					<div className="flex items-center justify-between px-5 py-4 border-b border-border">
						<div className="flex items-center gap-3">
							<div className="flex size-9 items-center justify-center rounded-none border border-border bg-muted">
								<span className="text-sm font-semibold uppercase">{p.id.slice(0, 2)}</span>
							</div>
							<div>
								<h3 className="text-sm font-medium capitalize">{p.id}</h3>
								<p className="text-xs text-muted-foreground">
									{p.oauth_enabled ? "OAuth 2.0 enabled" : "OAuth not yet implemented"}
								</p>
							</div>
						</div>
						<span className={`inline-flex items-center gap-1.5 rounded-none border px-2 py-0.5 text-xs font-medium ${
							p.oauth_enabled
								? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
								: "bg-amber-500/10 text-amber-400 border-amber-500/20"
						}`}>
							<span className={`size-1.5 rounded-full ${p.oauth_enabled ? "bg-emerald-400" : "bg-amber-400"}`} />
							{p.oauth_enabled ? "Available" : "Planned"}
						</span>
					</div>
					<div className="px-5 py-3">
						<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
							Scopes ({p.scopes.length})
						</p>
						<div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
							{p.scopes.map((scope) => (
								<code key={scope} className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1">
									{scope}
								</code>
							))}
						</div>
					</div>
				</div>
			))}
		</div>
	);
}

export function ConnectPage() {
	const connectApps = useConnectAppsStore();
	const [activeTab, setActiveTab] = useState("apps");
	const [showCreateModal, setShowCreateModal] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

	const [cName, setCName] = useState("");
	const [cSlug, setCSlug] = useState("");
	const [cRedirectUri, setCRedirectUri] = useState("");
	const [cProviders, setCProviders] = useState("google");
	const [cError, setCError] = useState("");

	useEffect(() => {
		connectApps.fetch();
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
						Register apps that issue scoped, auditable access for agents acting on behalf of users.
					</p>
				</div>
				{activeTab === "apps" && (
					<Button onClick={() => setShowCreateModal(true)}>
						<PlusIcon className="size-4 me-1.5" />
						Create app
					</Button>
				)}
			</div>

			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<div className="rounded-none border border-border bg-background px-5 py-5 flex flex-col justify-center min-h-[88px]">
					<div className="flex items-center justify-between">
						<p className="text-2xl font-semibold tabular-nums">{connectApps.loading ? "..." : connectApps.apps.length}</p>
						<ShieldCheckIcon className="size-4 text-muted-foreground" />
					</div>
					<p className="text-sm text-muted-foreground mt-1">Registered apps</p>
				</div>
				<div className="rounded-none border border-border bg-background px-5 py-5 flex flex-col justify-center min-h-[88px]">
					<div className="flex items-center justify-between">
						<p className="text-2xl font-semibold tabular-nums">{totalGrants}</p>
						<UsersIcon className="size-4 text-muted-foreground" />
					</div>
					<p className="text-sm text-muted-foreground mt-1">Active grants</p>
				</div>
				<div className="rounded-none border border-border bg-background px-5 py-5 flex flex-col justify-center min-h-[88px]">
					<div className="flex items-center justify-between">
						<p className="text-2xl font-semibold tabular-nums">3</p>
						<GitBranchIcon className="size-4 text-muted-foreground" />
					</div>
					<p className="text-sm text-muted-foreground mt-1">Providers</p>
				</div>
				<div className="rounded-none border border-border bg-background px-5 py-5 flex flex-col justify-center min-h-[88px]">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<span className="size-2 rounded-full bg-emerald-400" />
							<span className="text-sm font-medium text-foreground">Active</span>
						</div>
						<KeyRoundIcon className="size-4 text-muted-foreground" />
					</div>
					<p className="text-sm text-muted-foreground mt-1">Connect SDK</p>
				</div>
			</div>

			<div className="flex gap-1 rounded-none border border-border bg-muted p-1">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						className={`flex h-8 items-center gap-2 rounded-none px-3 text-sm font-medium transition-colors ${
							activeTab === tab.id
								? "bg-background text-foreground border border-border"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						{tab.icon}
						{tab.label}
					</button>
				))}
			</div>

			{activeTab === "apps" && (
				<div className="rounded-lg border border-border">
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
			)}

			{activeTab === "providers" && <ProvidersTab />}

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