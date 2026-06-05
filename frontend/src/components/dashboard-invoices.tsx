"use client";

import { Button } from "@/components/ui/button";
import {
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { DashboardCard } from "@/components/dashboard-card";
import { ListOrderedIcon, Loader2Icon, ArrowRightIcon } from "lucide-react";
import { Link } from "react-router-dom";
import EmptyState from "./empty-state";

type Task = {
	id: string;
	endpoint: string;
	status: string;
	scheduled: string;
};

type Props = {
	tasks: Task[];
	loading?: boolean;
};

function statusColor(status: string) {
	switch (status.toLowerCase()) {
		case "completed": return "text-emerald-400";
		case "running": return "text-blue-400";
		case "failed": return "text-red-400";
		case "queued": return "text-yellow-400";
		default: return "text-muted-foreground";
	}
}

export function DashboardInvoices({ tasks, loading }: Props) {
	return (
		<DashboardCard className="relative gap-0 md:col-span-2 lg:col-span-4">
			<CardHeader className="border-b border-border">
				<CardTitle className="text-base">Recent tasks</CardTitle>
				<CardDescription>Latest scheduled task executions.</CardDescription>
			</CardHeader>
			<CardContent className="mask-b-from-50% mask-b-to-100% px-0">
				{loading ? (
					<div className="flex h-40 items-center justify-center">
						<Loader2Icon className="size-5 animate-spin text-muted-foreground" />
					</div>
				) : tasks.length === 0 ? (
					<EmptyState title="No tasks yet" description="Your recent tasks will appear here once you publish one." icon={<ListOrderedIcon className="size-12 text-muted-foreground" />} />
				) : (
					<Table>
						<TableCaption className="sr-only">
							Recent tasks with endpoint, status, and scheduled time.
						</TableCaption>
						<TableHeader>
							<TableRow>
								<TableHead className="ps-6">Endpoint</TableHead>
								<TableHead>Task ID</TableHead>
								<TableHead className="pe-6 text-right">Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{tasks.map((t) => (
								<TableRow className="h-12" key={t.id}>
									<TableCell className="max-w-40 truncate ps-6 font-medium">
										{t.endpoint}
									</TableCell>
									<TableCell className="text-muted-foreground tabular-nums">
										{t.id}
									</TableCell>
									<TableCell className={`pe-6 text-right tabular-nums ${statusColor(t.status)}`}>
										{t.status}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
			{tasks.length > 0 && (
				<div className="mask-t-from-30% absolute inset-x-0 bottom-0 flex h-1/5 items-center justify-center bg-background">
					<Button asChild className="relative" variant="ghost">
						<Link to="/runs">
							View All
							<ArrowRightIcon aria-hidden="true" />
						</Link>
					</Button>
				</div>
			)}
		</DashboardCard>
	);
}
