"use client";

import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { DeleteConfirmModal } from "@/components/ui/delete-confirm-modal";
import { Building2Icon, Trash2Icon } from "lucide-react";

type Props = {
	saved: boolean;
	onSave: () => void;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<div className="grid gap-1.5">
			<label className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
				{label}
			</label>
			{children}
			{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
		</div>
	);
}

export function GeneralTab({ saved, onSave }: Props) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [showDeleteWorkspace, setShowDeleteWorkspace] = useState(false);

	return (
		<div className="grid gap-4">
			<Card>
				<CardHeader>
					<div className="space-y-1.5">
						<CardTitle>Workspace</CardTitle>
						<CardDescription>Identity and defaults for new actions.</CardDescription>
					</div>
				</CardHeader>
				<CardContent className="grid gap-5">
					<div className="flex items-center gap-3">
						<span className="grid size-10 place-items-center rounded-[4px] border border-border bg-muted text-foreground">
							<Building2Icon className="size-5" />
						</span>
						<div className="min-w-0 flex-1">
							<p className="text-[13px] font-medium">Workspace avatar</p>
							<p className="text-xs text-muted-foreground">A logo shown across the console.</p>
						</div>
						<Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
							Upload
						</Button>
						<input ref={fileInputRef} type="file" accept="image/*" className="hidden" />
					</div>
					<Field label="Workspace name">
						<Input defaultValue="Runmesh" className="max-w-sm" />
					</Field>
					<Field label="Default endpoint" hint="Base URL for new webhook actions.">
						<Input defaultValue="https://api.runmesh.app/webhooks" className="max-w-md" />
					</Field>
					<Field label="Max retries" hint="Default retry count for failed actions.">
						<Input defaultValue="3" className="max-w-20" />
					</Field>
				</CardContent>
				<CardFooter className="justify-end">
					<Button onClick={onSave}>{saved ? "Saved" : "Save changes"}</Button>
				</CardFooter>
			</Card>

			<Card>
				<CardHeader>
					<div className="space-y-1.5">
						<CardTitle>Danger zone</CardTitle>
						<CardDescription>Irreversible actions.</CardDescription>
					</div>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-destructive/20 bg-destructive/5 px-4 py-3">
						<div className="grid gap-0.5">
							<p className="text-[13px] font-medium">Delete workspace</p>
							<p className="text-xs text-muted-foreground">Permanently remove all tasks, runs, and settings.</p>
						</div>
						<Button variant="destructive" size="sm" onClick={() => setShowDeleteWorkspace(true)}>
							<Trash2Icon className="me-1.5 size-3.5" />
							Delete workspace
						</Button>
					</div>
				</CardContent>
			</Card>

			<DeleteConfirmModal
				open={showDeleteWorkspace}
				onClose={() => setShowDeleteWorkspace(false)}
				title="Delete workspace"
				itemName="this workspace"
				description="This cannot be undone. All tasks, runs, and settings will be permanently removed."
				onConfirm={() => setShowDeleteWorkspace(false)}
			/>
		</div>
	);
}
