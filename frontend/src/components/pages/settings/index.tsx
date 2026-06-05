"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { GeneralTab } from "./general-tab";
import { WebhooksTab } from "./webhooks-tab";
import { ApiKeysTab } from "./api-keys-tab";
import { useApiKeysStore } from "@/stores/api-keys-store";
import { useWebhooksStore } from "@/stores/webhooks-store";
import { WebhookIcon, KeyRoundIcon, Settings2Icon, Loader2Icon, CopyIcon, CheckIcon } from "lucide-react";

const tabs = [
	{ id: "general", label: "General", icon: <Settings2Icon className="size-4" /> },
	{ id: "webhooks", label: "Webhooks", icon: <WebhookIcon className="size-4" /> },
	{ id: "api-keys", label: "API Keys", icon: <KeyRoundIcon className="size-4" /> },
] as const;

export function SettingsPage() {
	const [activeTab, setActiveTab] = useState("general");
	const [saved, setSaved] = useState(false);
	const [showWebhookModal, setShowWebhookModal] = useState(false);
	const [showKeyModal, setShowKeyModal] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<{ type: "webhook" | "key"; id: string; name: string } | null>(null);
	const [copied, setCopied] = useState(false);

	const apiKeys = useApiKeysStore();
	const webhooks = useWebhooksStore();

	const [whName, setWhName] = useState("");
	const [whUrl, setWhUrl] = useState("");
	const [whEvents, setWhEvents] = useState("");
	const [whError, setWhError] = useState("");

	const [keyName, setKeyName] = useState("");
	const [keyPermissions, setKeyPermissions] = useState<string[]>(["write"]);
	const [keyError, setKeyError] = useState("");
	const [lastCreatedWebhookSecret, setLastCreatedWebhookSecret] = useState<string | null>(null);
	const [lastCreatedKey, setLastCreatedKey] = useState<string | null>(null);

	useEffect(() => {
		if (activeTab === "api-keys") apiKeys.fetch();
		if (activeTab === "webhooks") webhooks.fetch();
	}, [activeTab]);

	const handleSave = () => {
		setSaved(true);
		setTimeout(() => setSaved(false), 2000);
	};

	const handleCreateWebhook = async (e: React.FormEvent) => {
		e.preventDefault();
		setWhError("");
		if (!whName.trim() || !whUrl.trim()) {
			setWhError("Name and URL are required");
			return;
		}
		const secret = await webhooks.create(
			whName.trim(),
			whUrl.trim(),
			whEvents.trim() || "task.completed,task.failed",
		);
		if (secret) {
			setLastCreatedWebhookSecret(secret);
		} else {
			setShowWebhookModal(false);
			setWhName("");
			setWhUrl("");
			setWhEvents("");
		}
	};

	const handleCreateKey = async (e: React.FormEvent) => {
		e.preventDefault();
		setKeyError("");
		if (!keyName.trim()) {
			setKeyError("Name is required");
			return;
		}
		const rawKey = await apiKeys.create(keyName.trim(), keyPermissions);
		if (rawKey) {
			setLastCreatedKey(rawKey);
			setKeyName("");
		}
	};

	const handleDeleteWebhook = async (id: string) => {
		await webhooks.remove(id);
		setDeleteTarget(null);
	};

	const handleDeleteKey = async (id: string) => {
		await apiKeys.remove(id);
		setDeleteTarget(null);
	};

	return (
		<div className="grid gap-4">
			<div>
				<h1 className="text-xl font-semibold tracking-tight">Settings</h1>
				<p className="text-sm text-muted-foreground mt-0.5">
					Manage your workspace configuration.
				</p>
			</div>

			<div className="flex gap-1 rounded-lg border border-border bg-muted p-1">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						onClick={() => setActiveTab(tab.id)}
						className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
							activeTab === tab.id
								? "bg-background text-foreground border border-border"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						{tab.icon}
						{tab.label}
					</button>
				))}
			</div>

			{activeTab === "general" && <GeneralTab saved={saved} onSave={handleSave} />}

			{activeTab === "webhooks" && (
				<WebhooksTab
					webhooks={webhooks.webhooks}
					loading={webhooks.loading}
					rotating={webhooks.rotating}
					onAdd={() => {
						setShowWebhookModal(true);
						setLastCreatedWebhookSecret(null);
						setWhName("");
						setWhUrl("");
						setWhEvents("task.completed,task.failed");
						setWhError("");
					}}
					onDelete={(id, name) => setDeleteTarget({ type: "webhook", id, name })}
					onRotate={(id) => webhooks.rotateSecret(id)}
				/>
			)}

			{activeTab === "api-keys" && (
				<ApiKeysTab
					keys={apiKeys.keys}
					loading={apiKeys.loading}
					onAdd={() => { setShowKeyModal(true); setLastCreatedKey(null); setKeyName(""); setKeyPermissions(["write"]); setKeyError(""); }}
					onDelete={(id, name) => setDeleteTarget({ type: "key", id, name })}
				/>
			)}

			<Modal
				open={showWebhookModal}
				onClose={() => {
					setShowWebhookModal(false);
					setLastCreatedWebhookSecret(null);
					setCopied(false);
				}}
				title={lastCreatedWebhookSecret ? "Webhook created" : "Add webhook"}
			>
				{lastCreatedWebhookSecret ? (
					<div className="grid gap-5">
						<p className="text-sm text-muted-foreground">
							Copy this signing secret now. You will not see it again unless you rotate it.
						</p>
						<div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3">
							<code className="flex-1 text-sm font-mono break-all">{lastCreatedWebhookSecret}</code>
							<button
								type="button"
								onClick={() => {
									navigator.clipboard.writeText(lastCreatedWebhookSecret);
									setCopied(true);
									setTimeout(() => setCopied(false), 2000);
								}}
								className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
							>
								{copied ? <CheckIcon className="size-4 text-emerald-400" /> : <CopyIcon className="size-4" />}
							</button>
						</div>
						<div className="flex justify-end pt-2 border-t border-border">
							<Button
								onClick={() => {
									setShowWebhookModal(false);
									setLastCreatedWebhookSecret(null);
									setWhName("");
									setWhUrl("");
									setWhEvents("");
									setCopied(false);
								}}
							>
								Done
							</Button>
						</div>
					</div>
				) : (
				<form onSubmit={handleCreateWebhook} className="grid gap-5">
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Name</label>
						<Input placeholder="e.g. Receipt delivery" value={whName} onChange={(e) => setWhName(e.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Endpoint URL</label>
						<Input placeholder="https://api.example.com/webhook" value={whUrl} onChange={(e) => setWhUrl(e.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Events</label>
						<Input
							placeholder="task.completed,task.failed"
							value={whEvents}
							onChange={(e) => setWhEvents(e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							Comma-separated: task.completed, task.failed, task.running
						</p>
					</div>
					{whError && <p className="text-sm text-red-400">{whError}</p>}
					<div className="flex justify-end gap-3 pt-2 border-t border-border">
						<Button type="button" variant="outline" onClick={() => setShowWebhookModal(false)}>Cancel</Button>
						<Button type="submit" disabled={webhooks.creating}>
							{webhooks.creating && <Loader2Icon className="size-4 animate-spin me-1.5" />}
							Add webhook
						</Button>
					</div>
				</form>
				)}
			</Modal>

			<Modal open={showKeyModal} onClose={() => { setShowKeyModal(false); setLastCreatedKey(null); setCopied(false); }} title={lastCreatedKey ? "API key created" : "Create API key"}>
				{lastCreatedKey ? (
					<div className="grid gap-5">
						<p className="text-sm text-muted-foreground">
							Copy this key now. You won't be able to see it again.
						</p>
						<div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3">
							<code className="flex-1 text-sm font-mono break-all">{lastCreatedKey}</code>
							<button
								onClick={() => {
									navigator.clipboard.writeText(lastCreatedKey);
									setCopied(true);
									setTimeout(() => setCopied(false), 2000);
								}}
								className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
							>
								{copied ? <CheckIcon className="size-4 text-emerald-400" /> : <CopyIcon className="size-4" />}
							</button>
						</div>
						<div className="flex justify-end pt-2 border-t border-border">
							<Button onClick={() => { setShowKeyModal(false); setLastCreatedKey(null); setCopied(false); }}>
								Done
							</Button>
						</div>
					</div>
				) : (
					<form onSubmit={handleCreateKey} className="grid gap-5">
						<div className="grid gap-1.5">
							<label className="text-sm font-medium">Name</label>
							<Input placeholder="e.g. Production" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
						</div>
						<div className="grid gap-1.5">
							<label className="text-sm font-medium">Permissions</label>
							<div className="grid gap-2">
								<label className="flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										className="rounded border-border"
										checked={keyPermissions.includes("write")}
										onChange={(e) => {
											setKeyPermissions(e.target.checked ? [...keyPermissions, "write"] : keyPermissions.filter((p) => p !== "write"));
										}}
									/>
									Full access
								</label>
								<label className="flex items-center gap-2 text-sm text-muted-foreground">
									<input
										type="checkbox"
										className="rounded border-border"
										checked={keyPermissions.includes("read")}
										onChange={(e) => {
											setKeyPermissions(e.target.checked ? [...keyPermissions, "read"] : keyPermissions.filter((p) => p !== "read"));
										}}
									/>
									Read-only
								</label>
							</div>
						</div>
						{keyError && <p className="text-sm text-red-400">{keyError}</p>}
						<div className="flex justify-end gap-3 pt-2 border-t border-border">
							<Button type="button" variant="outline" onClick={() => { setShowKeyModal(false); setLastCreatedKey(null); setCopied(false); }}>Cancel</Button>
							<Button type="submit" disabled={apiKeys.creating}>
								{apiKeys.creating && <Loader2Icon className="size-4 animate-spin me-1.5" />}
								Create key
							</Button>
						</div>
					</form>
				)}
			</Modal>

			<Modal
				open={!!deleteTarget}
				onClose={() => setDeleteTarget(null)}
				title={deleteTarget?.type === "webhook" ? "Delete webhook" : "Delete API key"}
			>
				<div className="grid gap-5">
					<p className="text-sm text-muted-foreground">
						Are you sure you want to delete <span className="font-medium text-foreground">{deleteTarget?.name}</span>?
						{deleteTarget?.type === "webhook"
							? " This endpoint will stop receiving task payloads."
							: " Any services using this key will lose access."}
					</p>
					<div className="flex justify-end gap-3 pt-2 border-t border-border">
						<Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
						<Button
							variant="destructive"
							onClick={() => {
								if (!deleteTarget) return;
								if (deleteTarget.type === "webhook") handleDeleteWebhook(deleteTarget.id);
								else handleDeleteKey(deleteTarget.id);
							}}
						>
							Delete
						</Button>
					</div>
				</div>
			</Modal>
		</div>
	);
}
