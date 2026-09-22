"use client";

import { cn } from "@/lib/utils";
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
import { Loader2Icon } from "lucide-react";

export type GrantStatus = "active" | "pending" | "expired" | "revoked" | "denied";

export type Grant = {
	id: string;
	user?: string;
	scope: string;
	resource: string;
	expiry: string;
	uses: string;
	status: GrantStatus;
};

const statusText: Record<GrantStatus, string> = {
	active: "text-emerald-400",
	pending: "text-amber-400",
	expired: "text-muted-foreground",
	revoked: "text-red-400",
	denied: "text-orange-400",
};

function GrantSkeletonRow({ showUser }: { showUser: boolean }) {
	return (
		<TableRow className="h-12">
			{showUser ? <TableCell className="ps-4"><Skeleton className="h-4 w-28" /></TableCell> : null}
			<TableCell className={showUser ? undefined : "ps-4"}><Skeleton className="h-4 w-36" /></TableCell>
			<TableCell><Skeleton className="h-4 w-32" /></TableCell>
			<TableCell><Skeleton className="h-4 w-16" /></TableCell>
			<TableCell><Skeleton className="h-4 w-12" /></TableCell>
			<TableCell><Skeleton className="h-4 w-14" /></TableCell>
			<TableCell className="pe-4"><Skeleton className="ms-auto h-6 w-16" /></TableCell>
		</TableRow>
	);
}

export function GrantsTable({
	grants,
	loading,
	onRevoke,
	onApprove,
	onDeny,
	showUser = false,
	actingId = null,
	flashId = null,
}: {
	grants: Grant[];
	loading?: boolean;
	onRevoke?: (grant: Grant) => void;
	onApprove?: (grant: Grant) => void;
	onDeny?: (grant: Grant) => void;
	showUser?: boolean;
	actingId?: string | null;
	flashId?: string | null;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					{showUser ? <TableHead className="ps-4">User</TableHead> : null}
					<TableHead className={showUser ? undefined : "ps-4"}>Scope</TableHead>
					<TableHead>Resource</TableHead>
					<TableHead>Expiry</TableHead>
					<TableHead>Uses</TableHead>
					<TableHead>Status</TableHead>
					<TableHead className="pe-4 text-right">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{loading ? (
					Array.from({ length: 3 }).map((_, index) => <GrantSkeletonRow key={index} showUser={showUser} />)
				) : (
				grants.map((grant) => {
					const acting = actingId === grant.id;
					return (
						<TableRow
							key={grant.id}
							className={cn(acting && "opacity-60", flashId === grant.id && "animate-row-flash")}
						>
							{showUser ? (
								<TableCell className="ps-4 text-[13px]">{grant.user ?? "—"}</TableCell>
							) : null}
							<TableCell className={cn("font-mono text-[12.5px] font-medium", !showUser && "ps-4")}>
								{grant.scope}
							</TableCell>
							<TableCell className="font-mono text-[12.5px] text-muted-foreground">{grant.resource}</TableCell>
							<TableCell className="text-[13px] text-muted-foreground">{grant.expiry}</TableCell>
							<TableCell className="text-[13px] text-muted-foreground tabular-nums">{grant.uses}</TableCell>
							<TableCell className={cn("text-[12.5px] capitalize", statusText[grant.status])}>
								{grant.status}
							</TableCell>
							<TableCell className="pe-4 text-right">
								{grant.status === "pending" ? (
									<div className="flex justify-end gap-1.5">
										<Button
											size="xs"
											disabled={actingId !== null}
											onClick={onApprove ? () => onApprove(grant) : undefined}
										>
											{acting && <Loader2Icon className="size-3.5 animate-spin" />}
											Approve
										</Button>
										<Button
											size="xs"
											variant="outline"
											disabled={actingId !== null}
											onClick={onDeny ? () => onDeny(grant) : undefined}
										>
											Deny
										</Button>
									</div>
								) : (
									<Button
										size="xs"
										variant="outline"
										onClick={onRevoke ? () => onRevoke(grant) : undefined}
										disabled={grant.status !== "active" || actingId !== null}
									>
										{acting && <Loader2Icon className="size-3.5 animate-spin" />}
										Revoke
									</Button>
								)}
							</TableCell>
						</TableRow>
					);
				})
				)}
			</TableBody>
		</Table>
	);
}
