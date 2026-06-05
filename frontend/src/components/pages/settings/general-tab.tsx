"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2Icon } from "lucide-react";

type Props = {
	saved: boolean;
	onSave: () => void;
};

export function GeneralTab({ saved, onSave }: Props) {
	const fileInputRef = useRef<HTMLInputElement>(null);

	return (
		<div className="grid gap-4">
			<section className="grid gap-4">
				<h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Workspace</h2>
				<div className="grid gap-4">
					<div className="flex items-center gap-3">
						<span className="grid size-10 place-items-center rounded-lg border border-border bg-muted text-foreground">
							<Building2Icon className="size-5" />
						</span>
						<div>
							<p className="text-sm font-medium text-foreground">Workspace avatar</p>
							<p className="text-xs text-muted-foreground">Upload a logo for your workspace.</p>
						</div>
						<Button variant="outline" size="sm" className="ml-auto" onClick={() => fileInputRef.current?.click()}>
							Upload
						</Button>
						<input ref={fileInputRef} type="file" accept="image/*" className="hidden" />
					</div>
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Workspace name</label>
						<Input defaultValue="Runmesh" className="max-w-sm" />
					</div>
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Default endpoint</label>
						<Input defaultValue="https://api.runmesh.app/webhooks" className="max-w-sm" />
						<p className="text-xs text-muted-foreground">Base URL for new webhook tasks.</p>
					</div>
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Max retries</label>
						<Input defaultValue="3" className="max-w-20" />
						<p className="text-xs text-muted-foreground">Default retry count for failed tasks.</p>
					</div>
				</div>
				<div>
					<Button onClick={onSave}>{saved ? "Saved" : "Save changes"}</Button>
				</div>
			</section>

			<hr className="border-border" />

			<section className="grid gap-4">
				<h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Danger zone</h2>
				<div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
					<div className="grid gap-0.5">
						<p className="text-sm font-medium">Delete workspace</p>
						<p className="text-xs text-muted-foreground">Permanently remove all tasks, runs, and settings.</p>
					</div>
					<Button
						variant="destructive"
						size="sm"
						onClick={() => {
							if (window.confirm("Are you sure you want to delete this workspace? This cannot be undone.")) {}
						}}
					>
						Delete workspace
					</Button>
				</div>
			</section>
		</div>
	);
}
