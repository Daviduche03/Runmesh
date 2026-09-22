"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { usePoliciesStore } from "@/lib/stores/policies-store";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/empty-state";
import { ScrollTextIcon } from "lucide-react";

export function PolicyChangelogPage() {
	const changes = usePoliciesStore((s) => s.changes);
	const loading = usePoliciesStore((s) => s.changesLoading);
	const fetchChanges = usePoliciesStore((s) => s.fetchChanges);

	useEffect(() => {
		fetchChanges();
	}, [fetchChanges]);

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h1 className="font-display text-[22px] font-medium tracking-[-0.02em]">Change log</h1>
				<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
					Policy is auditable. Every change carries who made it, what moved, and a record hash.
				</p>
			</div>

			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="space-y-1.5">
							<CardTitle>All changes</CardTitle>
							<CardDescription>Newest first. Rule edits, mode flips, and cap changes.</CardDescription>
						</div>
						<span className="text-[12px] text-muted-foreground">{changes.length} entries</span>
					</div>
				</CardHeader>
				<CardContent className="px-0">
					{loading && changes.length === 0 ? (
						<div className="grid gap-2 px-4 py-2">
							{[0, 1, 2].map((index) => (
								<Skeleton className="h-12 w-full rounded-[4px]" key={index} />
							))}
						</div>
					) : changes.length > 0 ? (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="ps-4">When</TableHead>
									<TableHead>By</TableHead>
									<TableHead>Change</TableHead>
									<TableHead className="pe-4 text-right">Record</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{changes.map((entry, index) => (
									<TableRow className="h-12" key={index}>
										<TableCell className="ps-4 font-mono text-[12px] text-muted-foreground tabular-nums">
											{entry.at}
										</TableCell>
										<TableCell className="text-[13px]">{entry.by}</TableCell>
										<TableCell className="text-[13px]">{entry.change}</TableCell>
										<TableCell className="pe-4 text-right font-mono text-[12px] text-muted-foreground">
											{entry.record}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					) : (
						<div className="px-4 pb-4">
							<EmptyState
								title="No policy changes yet"
								description="Edits to rules appear here with who made them."
								icon={<ScrollTextIcon className="size-6 text-muted-foreground" />}
							/>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
