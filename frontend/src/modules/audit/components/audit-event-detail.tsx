"use client";

import { useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AuditEvent } from "@/modules/audit/components/audit-table";
import { CheckIcon, CopyIcon } from "lucide-react";

function CopyValue({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			aria-label="Copy"
			onClick={() => {
				navigator.clipboard.writeText(value);
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			}}
			className="shrink-0 text-muted-foreground transition-[color,transform] duration-150 ease-[var(--ease-out)] hover:text-foreground active:scale-[0.9]"
		>
			{copied ? <CheckIcon className="size-3.5 text-emerald-400" /> : <CopyIcon className="size-3.5" />}
		</button>
	);
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-start justify-between gap-4 py-2.5">
			<dt className="shrink-0 text-[12px] text-muted-foreground">{label}</dt>
			<dd className="flex min-w-0 items-center gap-2 text-right font-mono text-[12.5px]">{children}</dd>
		</div>
	);
}

export function AuditEventDetail({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
	return (
		<Sheet
			open={!!event}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<SheetContent side="right" className="w-full sm:max-w-lg">
				{event ? (
					<>
						<SheetHeader>
							<SheetTitle>{event.action}</SheetTitle>
							<SheetDescription>
								{event.outcome} · {event.time}
							</SheetDescription>
						</SheetHeader>
						<div className="flex-1 overflow-y-auto px-4">
							<dl className="divide-y divide-border">
								<DetailRow label="Event">
									<span className="truncate">{event.id}</span>
									<CopyValue value={event.id} />
								</DetailRow>
								<DetailRow label="Thread">{event.threadId ?? "unchained"}</DetailRow>
								<DetailRow label="Run">
									<span className="truncate">{event.traceId ?? "unchained"}</span>
									{event.traceId ? <CopyValue value={event.traceId} /> : null}
								</DetailRow>
								<DetailRow label="Actor">
									{event.actor} · {event.actorType}
								</DetailRow>
								<DetailRow label="On behalf of">{event.onBehalfOf}</DetailRow>
								<DetailRow label="Mode">{event.mode}</DetailRow>
								<DetailRow label="Authority">{event.authority}</DetailRow>
								{event.argsText ? (
									<DetailRow label="Arguments">
										<span className="break-all text-left">{event.argsText}</span>
									</DetailRow>
								) : null}
								{event.resultText ? (
									<DetailRow label="Result">
										<span className="break-all text-left">{event.resultText}</span>
									</DetailRow>
								) : null}
								{event.childRunId ? (
									<DetailRow label="Spawned run">
										<span className="truncate">
											{event.childAgentName ?? "run"} · {event.childRunId}
										</span>
										<CopyValue value={event.childRunId} />
									</DetailRow>
								) : null}
							</dl>
						</div>
					</>
				) : null}
			</SheetContent>
		</Sheet>
	);
}
