import type { AuditEvent } from "@/modules/audit/components/audit-table";

const COLUMNS: (keyof AuditEvent)[] = [
	"id",
	"time",
	"actor",
	"actorType",
	"onBehalfOf",
	"mode",
	"type",
	"action",
	"authority",
	"outcome",
	"traceId",
	"threadId",
];

function cell(value: unknown): string {
	const text = value == null ? "" : String(value);
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Client-side CSV export of the (already filtered) ledger view. */
export function downloadAuditCsv(filename: string, events: AuditEvent[]) {
	const lines = [
		COLUMNS.join(","),
		...events.map((event) => COLUMNS.map((column) => cell(event[column])).join(",")),
	];
	const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
