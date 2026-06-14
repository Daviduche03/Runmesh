"use client";

import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { CheckIcon, CopyIcon, MoreVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import type { ConnectApp } from "@/stores/connect-apps-store";

type Props = {
	apps: ConnectApp[];
	loading: boolean;
	grantsLoading: boolean;
	grantsByApp: Record<string, { id: string; connect_user_id: string; scopes: string[]; status: string; granted_at: string }[]>;
	onAdd: () => void;
	onExpand: (appId: string) => void;
	onDelete: (id: string, name: string) => void;
};

export function ConnectAppsTab({
	apps,
	loading,
	grantsLoading,
	grantsByApp,
	onAdd,
	onExpand,
	onDelete,
}: Props) {
	const [expanded, setExpanded] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);

	const toggleExpanded = (appId: string) => {
		if (expanded === appId) {
			setExpanded(null);
			return;
		}
		setExpanded(appId);
		onExpand(appId);
	};

	const copyValue = (key: string, value: string) => {
		navigator.clipboard.writeText(value);
		setCopied(key);
		setTimeout(() => setCopied(null), 2000);
	};

	return (
		<div className="grid gap-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">Connect apps</h2>
					<p className="text-xs text-muted-foreground mt-1">
						Register apps that use Runmesh Connect for portable integrations and grants.
					</p>
				</div>
				<Button onClick={onAdd}>
					<PlusIcon className="size-4" />
					Create app
				</Button>
			</div>

			<div className="rounded-none border border-border">
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
						) : apps.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">
									No Connect apps yet. Create one to start a session flow.
								</TableCell>
							</TableRow>
						) : (
							apps.map((app) => {
								const isOpen = expanded === app.id;
								const grants = grantsByApp[app.id] ?? [];
								return (
									<Fragment key={app.id}>
										<TableRow
											className={`h-12 cursor-pointer ${isOpen ? "bg-muted/50" : ""}`}
											onClick={() => toggleExpanded(app.id)}
										>
											<TableCell className="ps-6 font-medium">{app.name}</TableCell>
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
															<MoreVerticalIcon className="size-4 text-muted-foreground" />
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent align="end" className="min-w-40">
														<DropdownMenuItem onClick={() => toggleExpanded(app.id)}>
															{isOpen ? "Hide details" : "View details"}
														</DropdownMenuItem>
														<DropdownMenuItem onClick={() => copyValue(`id-${app.id}`, app.id)}>
															{copied === `id-${app.id}` ? (
																<CheckIcon className="size-4 text-emerald-400" />
															) : (
																<CopyIcon className="size-4" />
															)}
															Copy app ID
														</DropdownMenuItem>
														<DropdownMenuItem onClick={() => copyValue(`slug-${app.id}`, app.slug)}>
															{copied === `slug-${app.id}` ? (
																<CheckIcon className="size-4 text-emerald-400" />
															) : (
																<CopyIcon className="size-4" />
															)}
															Copy slug
														</DropdownMenuItem>
														<DropdownMenuItem variant="destructive" onClick={() => onDelete(app.id, app.name)}>
															<Trash2Icon className="size-4" />
															Delete app
														</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											</TableCell>
										</TableRow>
										{isOpen && (
											<TableRow>
												<TableCell colSpan={6} className="bg-muted/30 px-6 py-4">
													<div className="grid gap-3">
														<div>
															<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">App ID</p>
															<code className="text-xs font-mono break-all">{app.id}</code>
														</div>
														<div>
															<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Redirect URIs</p>
															<p className="text-sm text-muted-foreground">{app.redirect_uris.join(", ") || "—"}</p>
														</div>
														<div>
															<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Grants</p>
															{grantsLoading && !grants.length ? (
																<Skeleton className="h-4 w-32" />
															) : grants.length === 0 ? (
																<p className="text-sm text-muted-foreground">No grants yet.</p>
															) : (
																<div className="grid gap-2">
																	{grants.map((grant) => (
																		<div key={grant.id} className="text-sm border border-border px-3 py-2">
																			<div className="font-mono text-xs">{grant.id}</div>
																			<div className="text-muted-foreground text-xs mt-1">
																				user {grant.connect_user_id} · {grant.status} · {grant.scopes.join(", ") || "—"}
																			</div>
																		</div>
																	))}
																</div>
															)}
														</div>
													</div>
												</TableCell>
											</TableRow>
										)}
									</Fragment>
								);
							})
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
