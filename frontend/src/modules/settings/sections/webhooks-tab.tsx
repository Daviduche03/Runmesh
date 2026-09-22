"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { PlusIcon, Trash2Icon, CopyIcon, CheckIcon, RefreshCwIcon, Loader2Icon, RotateCcwIcon } from "lucide-react";
import type { Webhook, WebhookDeadLetter } from "@/lib/stores/webhooks-store";

type Props = {
	webhooks: Webhook[];
	deadLetters: WebhookDeadLetter[];
	loading: boolean;
	dlqLoading: boolean;
	rotating: boolean;
	replaying: string | null;
	onAdd: () => void;
	onDelete: (id: string, name: string) => void;
	onRotate: (id: string) => Promise<string | null>;
	onReplayDeadLetter: (id: string) => Promise<void>;
	onDismissDeadLetter: (id: string, name: string) => void;
};

export function WebhooksTab({
	webhooks,
	deadLetters,
	loading,
	dlqLoading,
	rotating,
	replaying,
	onAdd,
	onDelete,
	onRotate,
	onReplayDeadLetter,
	onDismissDeadLetter,
}: Props) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const selected = webhooks.find((w) => w.id === selectedId) ?? webhooks[0] ?? null;

	const copySecret = (secret: string) => {
		navigator.clipboard.writeText(secret);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const handleRotate = async () => {
		if (!selected) return;
		const secret = await onRotate(selected.id);
		if (secret) {
			setRevealedSecret(secret);
			setCopied(false);
		}
	};

	return (
		<div className="grid gap-4">
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="space-y-1.5">
							<CardTitle>Endpoints</CardTitle>
							<CardDescription>Runmesh POSTs signed event payloads when tasks change state.</CardDescription>
						</div>
						<Button onClick={onAdd}>
							<PlusIcon className="size-4" />
							Add webhook
						</Button>
					</div>
				</CardHeader>
				<CardContent className="px-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="ps-4">Name</TableHead>
								<TableHead>URL</TableHead>
								<TableHead>Events</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="pe-4 text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{loading ? (
								Array.from({ length: 3 }).map((_, i) => (
									<TableRow className="h-12" key={i}>
										<TableCell className="ps-4"><Skeleton className="h-4 w-20" /></TableCell>
										<TableCell><Skeleton className="h-4 w-40" /></TableCell>
										<TableCell><Skeleton className="h-4 w-24" /></TableCell>
										<TableCell><Skeleton className="h-4 w-12" /></TableCell>
										<TableCell className="pe-4"><Skeleton className="ms-auto h-4 w-8" /></TableCell>
									</TableRow>
								))
							) : webhooks.length === 0 ? (
								<TableRow>
									<TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
										No webhooks yet. Add one to receive task events.
									</TableCell>
								</TableRow>
							) : (
								webhooks.map((w) => (
									<TableRow
										className={`h-12 cursor-pointer active:bg-muted/70 ${selected?.id === w.id ? "bg-muted/50" : ""}`}
										key={w.id}
										onClick={() => {
											setSelectedId(w.id);
											setRevealedSecret(null);
											setCopied(false);
										}}
									>
										<TableCell className="ps-4 font-medium">{w.name}</TableCell>
										<TableCell className="max-w-56 truncate font-mono text-sm text-muted-foreground">
											{w.url}
										</TableCell>
										<TableCell className="max-w-40 truncate text-sm text-muted-foreground">{w.events}</TableCell>
										<TableCell className="text-[12.5px] capitalize text-emerald-400">{w.status}</TableCell>
										<TableCell className="pe-4 text-right">
											<Button
												variant="ghost"
												size="icon-sm"
												onClick={(e) => {
													e.stopPropagation();
													onDelete(w.id, w.name);
												}}
											>
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

			{selected ? (
				<Card>
					<CardHeader>
						<div className="space-y-1.5">
							<CardTitle>Signing secret</CardTitle>
							<CardDescription>
								For {selected.name}. The full secret is only shown when you create or rotate it.
							</CardDescription>
						</div>
					</CardHeader>
					<CardContent className="grid gap-3">
						<div className="flex flex-wrap gap-2">
							<Input
								value={revealedSecret ?? selected.secret_hint ?? ""}
								className="max-w-md font-mono"
								readOnly
							/>
							{revealedSecret ? (
								<Button variant="outline" size="sm" onClick={() => copySecret(revealedSecret)}>
									{copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
									Copy
								</Button>
							) : null}
							<Button variant="outline" size="sm" disabled={rotating} onClick={handleRotate}>
								{rotating ? <Loader2Icon className="size-3.5 animate-spin" /> : <RefreshCwIcon className="size-3.5" />}
								Rotate
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							Verify deliveries with the{" "}
							<code className="font-mono text-foreground">X-Runmesh-Signature</code> header.
						</p>
					</CardContent>
				</Card>
			) : null}

			<Card>
				<CardHeader>
					<div className="space-y-1.5">
						<CardTitle>Dead letters</CardTitle>
						<CardDescription>Events that failed after all delivery retries. Replay or dismiss.</CardDescription>
					</div>
				</CardHeader>
				<CardContent className="px-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="ps-4">Webhook</TableHead>
								<TableHead>Event</TableHead>
								<TableHead>Error</TableHead>
								<TableHead>Failed</TableHead>
								<TableHead className="pe-4 text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{dlqLoading ? (
								Array.from({ length: 2 }).map((_, i) => (
									<TableRow className="h-12" key={i}>
										<TableCell className="ps-4"><Skeleton className="h-4 w-24" /></TableCell>
										<TableCell><Skeleton className="h-4 w-20" /></TableCell>
										<TableCell><Skeleton className="h-4 w-32" /></TableCell>
										<TableCell><Skeleton className="h-4 w-20" /></TableCell>
										<TableCell className="pe-4"><Skeleton className="ms-auto h-4 w-16" /></TableCell>
									</TableRow>
								))
							) : deadLetters.length === 0 ? (
								<TableRow>
									<TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
										No failed deliveries.
									</TableCell>
								</TableRow>
							) : (
								deadLetters.map((item) => (
									<TableRow className="h-12" key={item.id}>
										<TableCell className="ps-4 font-medium">{item.webhook_name || item.webhook_id}</TableCell>
										<TableCell className="text-sm text-muted-foreground">{item.event}</TableCell>
										<TableCell className="max-w-48 truncate text-sm text-muted-foreground">
											{item.last_status_code ? `HTTP ${item.last_status_code}` : item.last_error}
										</TableCell>
										<TableCell className="text-sm text-muted-foreground">
											{new Date(item.failed_at).toLocaleString()}
										</TableCell>
										<TableCell className="pe-4 text-right">
											<div className="flex justify-end gap-1">
												<Button
													variant="ghost"
													size="icon-sm"
													disabled={replaying === item.id}
													onClick={() => onReplayDeadLetter(item.id)}
												>
													{replaying === item.id ? (
														<Loader2Icon className="size-4 animate-spin" />
													) : (
														<RotateCcwIcon className="size-4 text-muted-foreground" />
													)}
												</Button>
												<Button
													variant="ghost"
													size="icon-sm"
													onClick={() => onDismissDeadLetter(item.id, item.webhook_name || item.webhook_id)}
												>
													<Trash2Icon className="size-4 text-muted-foreground" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
		</div>
	);
}
