"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { PlusIcon, Trash2Icon } from "lucide-react";
import type { ApiKey } from "@/stores/api-keys-store";

type Props = {
	keys: ApiKey[];
	loading: boolean;
	onAdd: () => void;
	onDelete: (id: string, name: string) => void;
};

export function ApiKeysTab({ keys, loading, onAdd, onDelete }: Props) {
	return (
		<div className="grid gap-4">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">Keys</h2>
						<p className="text-xs text-muted-foreground mt-1">
							API keys for authenticating requests to the Runmesh API.
						</p>
					</div>
					<Button onClick={onAdd}>
						<PlusIcon className="size-4" />
						Create key
					</Button>
				</div>

				<div className="rounded-none border border-border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="ps-6">Name</TableHead>
								<TableHead>Created</TableHead>
								<TableHead>Last used</TableHead>
								<TableHead className="pe-6 text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{loading ? (
								<>
									{Array.from({ length: 3 }).map((_, i) => (
										<TableRow className="h-12" key={i}>
											<TableCell className="ps-6"><Skeleton className="h-4 w-20" /></TableCell>
											<TableCell><Skeleton className="h-4 w-24" /></TableCell>
											<TableCell><Skeleton className="h-4 w-16" /></TableCell>
											<TableCell className="pe-6"><Skeleton className="h-4 w-8 ms-auto" /></TableCell>
										</TableRow>
									))}
								</>
							) : keys.length === 0 ? (
								<TableRow>
									<TableCell colSpan={4} className="text-center py-8 text-sm text-muted-foreground">
										No API keys yet. Create one to get started.
									</TableCell>
								</TableRow>
							) : (
								keys.map((k) => (
									<TableRow className="h-12" key={k.id}>
										<TableCell className="ps-6 font-medium">{k.name}</TableCell>
										<TableCell className="text-muted-foreground text-sm">{k.created_at ? new Date(k.created_at).toLocaleDateString() : "—"}</TableCell>
										<TableCell className="text-muted-foreground text-sm">{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "Never"}</TableCell>
										<TableCell className="pe-6 text-right">
											<Button variant="ghost" size="icon-sm" onClick={() => onDelete(k.id, k.name)}>
												<Trash2Icon className="size-4 text-muted-foreground" />
											</Button>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
		</div>
	);
}
