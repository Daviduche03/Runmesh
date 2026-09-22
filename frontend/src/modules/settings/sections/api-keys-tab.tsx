"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { PlusIcon, Trash2Icon } from "lucide-react";
import type { ApiKey } from "@/lib/stores/api-keys-store";

type Props = {
	keys: ApiKey[];
	loading: boolean;
	onAdd: () => void;
	onDelete: (id: string, name: string) => void;
};

export function ApiKeysTab({ keys, loading, onAdd, onDelete }: Props) {
	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1.5">
						<CardTitle>API keys</CardTitle>
						<CardDescription>Keys for authenticating requests to the Runmesh API.</CardDescription>
					</div>
					<Button onClick={onAdd}>
						<PlusIcon className="size-4" />
						Create key
					</Button>
				</div>
			</CardHeader>
			<CardContent className="px-0">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="ps-4">Name</TableHead>
							<TableHead>Created</TableHead>
							<TableHead>Last used</TableHead>
							<TableHead className="pe-4 text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{loading ? (
							Array.from({ length: 3 }).map((_, i) => (
								<TableRow className="h-12" key={i}>
									<TableCell className="ps-4"><Skeleton className="h-4 w-20" /></TableCell>
									<TableCell><Skeleton className="h-4 w-24" /></TableCell>
									<TableCell><Skeleton className="h-4 w-16" /></TableCell>
									<TableCell className="pe-4"><Skeleton className="ms-auto h-4 w-8" /></TableCell>
								</TableRow>
							))
						) : keys.length === 0 ? (
							<TableRow>
								<TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
									No API keys yet. Create one to get started.
								</TableCell>
							</TableRow>
						) : (
							keys.map((k) => (
								<TableRow className="h-12" key={k.id}>
									<TableCell className="ps-4 font-medium">{k.name}</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{k.created_at ? new Date(k.created_at).toLocaleDateString() : "—"}
									</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "Never"}
									</TableCell>
									<TableCell className="pe-4 text-right">
										<Button variant="ghost" size="icon-sm" onClick={() => onDelete(k.id, k.name)}>
											<Trash2Icon className="size-4 text-muted-foreground" />
										</Button>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
