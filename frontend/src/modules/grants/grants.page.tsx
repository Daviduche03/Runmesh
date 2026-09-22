"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedControl } from "@/components/segmented-control";
import { GrantsTable, type Grant, type GrantStatus } from "@/modules/grants/components/grants-table";
import EmptyState from "@/components/empty-state";
import { useGrantsStore, type BackendGrant } from "@/lib/stores/grants-store";
import { KeyRoundIcon } from "lucide-react";
import { toast } from "sonner";

function formatExpiry(grant: BackendGrant): string {
	switch (grant.status) {
		case "pending":
			return "pending consent";
		case "revoked":
			return "revoked";
		case "denied":
			return "denied";
		case "expired":
			return "expired";
		default: {
			if (grant.valid_until == null) return "no expiry";
			const seconds = grant.seconds_until_expiration;
			if (seconds == null) return grant.valid_until;
			if (seconds < 3600) return `in ${Math.max(1, Math.round(seconds / 60))}m`;
			if (seconds < 86400) return `in ${Math.round(seconds / 3600)}h`;
			return `in ${Math.round(seconds / 86400)}d`;
		}
	}
}

function toRow(grant: BackendGrant): Grant {
	const [first, ...rest] = grant.scopes;
	return {
		id: grant.id,
		user: grant.user,
		scope: rest.length > 0 ? `${first} +${rest.length}` : (first ?? "—"),
		resource: grant.resource ?? "—",
		expiry: formatExpiry(grant),
		uses: `${grant.uses} / ${grant.max_uses ?? "—"}`,
		status: grant.status,
	};
}

type Filter = "all" | GrantStatus;

const titles: Record<Filter, string> = {
	all: "All grants",
	pending: "Pending consent",
	active: "Active grants",
	expired: "Expired grants",
	denied: "Denied grants",
	revoked: "Revoked grants",
};

export function GrantsPage() {
	const grants = useGrantsStore((s) => s.grants);
	const loading = useGrantsStore((s) => s.loading);
	const fetchGrants = useGrantsStore((s) => s.fetch);
	const approve = useGrantsStore((s) => s.approve);
	const deny = useGrantsStore((s) => s.deny);
	const revoke = useGrantsStore((s) => s.revoke);
	const [actingId, setActingId] = useState<string | null>(null);
	const [flashId, setFlashId] = useState<string | null>(null);
	const prevStatuses = useRef(new Map<string, GrantStatus>());
	const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		fetchGrants("all");
	}, [fetchGrants]);

	// Flash rows whose status changed since the last fetch (approve/deny/revoke landing).
	useEffect(() => {
		const changed = grants.find((grant) => prevStatuses.current.get(grant.id) !== undefined && prevStatuses.current.get(grant.id) !== grant.status);
		prevStatuses.current = new Map(grants.map((grant) => [grant.id, grant.status]));
		if (changed) {
			setFlashId(changed.id);
			if (flashTimer.current) clearTimeout(flashTimer.current);
			flashTimer.current = setTimeout(() => setFlashId(null), 1300);
		}
		return () => {
			if (flashTimer.current) clearTimeout(flashTimer.current);
		};
	}, [grants]);

	const countBy = (status: GrantStatus) => grants.filter((g) => g.status === status).length;

	const handleApprove = async (grant: Grant) => {
		setActingId(grant.id);
		const message = await approve(grant.id);
		setActingId(null);
		if (message) toast.error(message);
		else toast.success("Grant approved");
	};
	const handleDeny = async (grant: Grant) => {
		setActingId(grant.id);
		const message = await deny(grant.id);
		setActingId(null);
		if (message) toast.error(message);
		else toast.success("Grant denied");
	};
	const handleRevoke = async (grant: Grant) => {
		setActingId(grant.id);
		const message = await revoke(grant.id);
		setActingId(null);
		if (message) toast.error(message);
		else toast.success("Grant revoked");
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
				<div>
					<h1 className="font-display text-[22px] font-medium tracking-[-0.02em]">Grants</h1>
					<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
						Consent and scoped access issued on behalf of your users. This is where an agent is allowed to act,
						and for how long.
					</p>
				</div>
			</div>

			<FilterableGrants
				grants={grants}
				loading={loading}
				actingId={actingId}
				flashId={flashId}
				countBy={countBy}
				onApprove={handleApprove}
				onDeny={handleDeny}
				onRevoke={handleRevoke}
			/>
		</div>
	);
}

function FilterableGrants({
	grants,
	loading,
	actingId,
	flashId,
	countBy,
	onApprove,
	onDeny,
	onRevoke,
}: {
	grants: BackendGrant[];
	loading: boolean;
	actingId: string | null;
	flashId: string | null;
	countBy: (status: GrantStatus) => number;
	onApprove: (grant: Grant) => void;
	onDeny: (grant: Grant) => void;
	onRevoke: (grant: Grant) => void;
}) {
	const [filter, setFilter] = useState<Filter>("all");
	const rows = grants
		.filter((grant) => filter === "all" || grant.status === filter)
		.map(toRow);

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1.5">
						<CardTitle>{titles[filter]}</CardTitle>
						<CardDescription>Scoped to an agent, a resource, and an expiry.</CardDescription>
					</div>
					<SegmentedControl
						options={[
							{ label: `All (${grants.length})`, value: "all" },
							{ label: `Pending (${countBy("pending")})`, value: "pending" },
							{ label: `Active (${countBy("active")})`, value: "active" },
							{ label: `Expired (${countBy("expired")})`, value: "expired" },
							{ label: `Denied (${countBy("denied")})`, value: "denied" },
							{ label: `Revoked (${countBy("revoked")})`, value: "revoked" },
						]}
						value={filter}
						onChange={setFilter}
					/>
				</div>
			</CardHeader>
			<CardContent className="px-0">
				{loading && grants.length === 0 ? (
					<GrantsTable grants={[]} loading showUser />
				) : rows.length > 0 ? (
					<GrantsTable
						grants={rows}
						showUser
						actingId={actingId}
						flashId={flashId}
						onApprove={onApprove}
						onDeny={onDeny}
						onRevoke={onRevoke}
					/>
				) : (
					<div className="px-4 pb-4">
						<EmptyState
							title="No grants yet"
							description="Grants appear here when your users connect accounts and agents request access."
							icon={<KeyRoundIcon className="size-6 text-muted-foreground" />}
						/>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
