"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export type Connection = {
	id: string;
	user: string;
	provider: string;
	account: string;
	scope: string;
	age: string;
};

function ConnectionSkeletonRow() {
	return (
		<TableRow className="h-12">
			<TableCell className="ps-4"><Skeleton className="h-4 w-32" /></TableCell>
			<TableCell><Skeleton className="h-4 w-16" /></TableCell>
			<TableCell><Skeleton className="h-4 w-24" /></TableCell>
			<TableCell><Skeleton className="h-4 w-24" /></TableCell>
			<TableCell><Skeleton className="h-4 w-12" /></TableCell>
		</TableRow>
	);
}

export function ConnectionsTable({
	connections,
	loading,
}: {
	connections: Connection[];
	loading?: boolean;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="ps-4">User</TableHead>
					<TableHead>Provider</TableHead>
					<TableHead>Account</TableHead>
					<TableHead>Scope</TableHead>
					<TableHead>Connected</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{loading ? (
					Array.from({ length: 3 }).map((_, index) => <ConnectionSkeletonRow key={index} />)
				) : (
					connections.map((connection) => (
						<TableRow key={connection.id}>
							<TableCell className="ps-4 text-[13px]">{connection.user}</TableCell>
							<TableCell className="text-[13px] font-medium">{connection.provider}</TableCell>
							<TableCell className="font-mono text-[12.5px] text-muted-foreground">{connection.account}</TableCell>
							<TableCell className="font-mono text-[12.5px] text-muted-foreground">{connection.scope}</TableCell>
							<TableCell className="text-[13px] text-muted-foreground">{connection.age}</TableCell>
						</TableRow>
					))
				)}
			</TableBody>
		</Table>
	);
}
