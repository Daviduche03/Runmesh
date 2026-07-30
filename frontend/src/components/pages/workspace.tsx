import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Modal } from "@/components/ui/modal"
import { apiGet, apiPost, apiDelete } from "@/lib/api"
import { FolderOpenIcon, TerminalIcon, RefreshCwIcon, PlusIcon, Trash2Icon, HardDriveIcon, CloudIcon, CheckCircle2Icon, Loader2Icon, TimerIcon } from "lucide-react"

type Project = {
	id: string
	prefix: string
	bucket: string
	local_path: string | null
	last_synced_at: string | null
	created_at: string
	updated_at: string
}

type StorageOverview = {
	totalProjects: number
	totalFiles: number
	totalBytes: number
}

export function WorkspacePage() {
	const [projects, setProjects] = useState<Project[]>([])
	const [loading, setLoading] = useState(true)
	const [showLinkModal, setShowLinkModal] = useState(false)
	const [linkPrefix, setLinkPrefix] = useState("")
	const [linkBucket, setLinkBucket] = useState("")
	const [linkPath, setLinkPath] = useState("")
	const [linkError, setLinkError] = useState("")
	const [linking, setLinking] = useState(false)
	const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
	const [deleting, setDeleting] = useState(false)
	const [storage, setStorage] = useState<StorageOverview>({ totalProjects: 0, totalFiles: 0, totalBytes: 0 })

	const fetchProjects = useCallback(async () => {
		setLoading(true)
		try {
			const { data } = await apiGet<Project[]>("/api/workspace/projects")
			setProjects(data ?? [])
			setStorage(prev => ({ ...prev, totalProjects: data?.length ?? 0 }))
		} catch {
			setProjects([])
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void fetchProjects()
	}, [fetchProjects])

	const handleLinkProject = async (e: React.FormEvent) => {
		e.preventDefault()
		setLinkError("")
		if (!linkPrefix.trim()) {
			setLinkError("Prefix is required")
			return
		}
		if (!linkBucket.trim()) {
			setLinkError("Bucket is required")
			return
		}
		setLinking(true)
		try {
			await apiPost("/api/workspace/projects", {
				prefix: linkPrefix.trim(),
				bucket: linkBucket.trim(),
				local_path: linkPath.trim() || null,
			})
			setShowLinkModal(false)
			setLinkPrefix("")
			setLinkBucket("")
			setLinkPath("")
			await fetchProjects()
		} catch {
			setLinkError("Failed to link project")
		} finally {
			setLinking(false)
		}
	}

	const handleDeleteProject = async () => {
		if (!deleteTarget) return
		setDeleting(true)
		try {
			await apiDelete(`/api/workspace/projects/${deleteTarget.id}`)
			setDeleteTarget(null)
			await fetchProjects()
		} catch {
			// ignore
		} finally {
			setDeleting(false)
		}
	}

	const formatBytes = (bytes: number) => {
		if (bytes === 0) return "0 B"
		const k = 1024
		const sizes = ["B", "KB", "MB", "GB"]
		const i = Math.floor(Math.log(bytes) / Math.log(k))
		return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
	}

	const formatDate = (dateStr: string | null) => {
		if (!dateStr) return "Never"
		try {
			return new Date(dateStr).toLocaleString()
		} catch {
			return dateStr
		}
	}

	return (
		<div className="grid gap-8">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">Workspace</h1>
					<p className="text-sm text-muted-foreground mt-1">
						Sync project files across devices and agents.
					</p>
				</div>
				<Button onClick={() => setShowLinkModal(true)}>
					<PlusIcon className="size-4 me-1.5" />
					Link project
				</Button>
			</div>

			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<div className="rounded-none border border-border bg-background px-5 py-5 flex flex-col justify-center min-h-[88px]">
					<div className="flex items-center justify-between">
						<p className="text-2xl font-semibold tabular-nums">{loading ? "..." : storage.totalProjects}</p>
						<FolderOpenIcon className="size-4 text-muted-foreground" />
					</div>
					<p className="text-sm text-muted-foreground mt-1">Linked projects</p>
				</div>
				<div className="rounded-none border border-border bg-background px-5 py-5 flex flex-col justify-center min-h-[88px]">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<span className="size-2 rounded-full bg-emerald-400" />
							<span className="text-sm font-medium text-foreground">Authenticated</span>
						</div>
						<TerminalIcon className="size-4 text-muted-foreground" />
					</div>
					<p className="text-sm text-muted-foreground mt-1">CLI status</p>
				</div>
				<div className="rounded-none border border-border bg-background px-5 py-5 flex flex-col justify-center min-h-[88px]">
					<div className="flex items-center justify-between">
						<p className="text-2xl font-semibold tabular-nums">{formatBytes(storage.totalBytes)}</p>
						<HardDriveIcon className="size-4 text-muted-foreground" />
					</div>
					<p className="text-sm text-muted-foreground mt-1">Storage used</p>
				</div>
				<div className="rounded-none border border-border bg-background px-5 py-5 flex flex-col justify-center min-h-[88px]">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<span className="size-2 rounded-full bg-emerald-400" />
							<span className="text-sm font-medium text-foreground">Up to date</span>
						</div>
						<CheckCircle2Icon className="size-4 text-muted-foreground" />
					</div>
					<p className="text-sm text-muted-foreground mt-1">Sync status</p>
				</div>
			</div>

			<div className="grid gap-6">
				<div className="flex items-center justify-between">
					<h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">Projects</h2>
					{projects.length > 0 && (
						<Button variant="ghost" size="sm" className="gap-2 text-xs text-muted-foreground">
							<RefreshCwIcon className="size-3.5" />
							Sync all
						</Button>
					)}
				</div>

				{loading ? (
					<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
						{[1, 2, 3].map((i) => (
							<div key={i} className="rounded-lg border border-border p-5 animate-pulse">
								<div className="h-4 w-24 bg-muted rounded mb-3" />
								<div className="h-3 w-40 bg-muted rounded mb-2" />
								<div className="h-3 w-32 bg-muted rounded" />
							</div>
						))}
					</div>
				) : projects.length === 0 ? (
					<div className="flex flex-col items-center gap-4 py-16 rounded-lg border border-border">
						<CloudIcon className="size-12 text-muted-foreground" />
						<div className="text-center">
							<p className="text-sm font-medium text-foreground">No projects linked</p>
							<p className="text-xs text-muted-foreground mt-1 max-w-sm">
								Install the CLI, configure your bucket, and run{" "}
								<code className="rounded bg-muted px-1.5 py-0.5 text-xs">runmesh workspace link</code>{" "}
								in a project directory. Or link one here.
							</p>
						</div>
						<Button variant="outline" size="sm" onClick={() => setShowLinkModal(true)}>
							<PlusIcon className="size-3.5 me-1.5" />
							Link project
						</Button>
					</div>
				) : (
					<div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
						{projects.map((p) => (
							<div key={p.id} className="rounded-lg border border-border p-5 hover:border-muted-foreground/30 transition-colors">
								<div className="flex items-start justify-between mb-3">
									<div className="flex items-center gap-3">
										<div className="grid size-9 place-items-center rounded-lg border border-border bg-muted">
											<FolderOpenIcon className="size-4 text-muted-foreground" />
										</div>
										<div>
											<p className="text-sm font-medium">{p.prefix}</p>
											<p className="text-xs text-muted-foreground">{p.bucket}</p>
										</div>
									</div>
									<Button
										variant="ghost"
										size="icon-sm"
										className="-mr-2 -mt-1 text-muted-foreground hover:text-red-400"
										onClick={() => setDeleteTarget(p)}
									>
										<Trash2Icon className="size-3.5" />
									</Button>
								</div>
								<div className="grid gap-1.5 text-xs text-muted-foreground">
									{p.local_path && (
										<div className="flex items-center gap-1.5">
											<TerminalIcon className="size-3" />
											<span className="truncate">{p.local_path}</span>
										</div>
									)}
									<div className="flex items-center gap-1.5">
										<TimerIcon className="size-3" />
										<span>Last synced: {formatDate(p.last_synced_at)}</span>
									</div>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			<div className="rounded-lg border border-border">
				<div className="px-5 py-4 border-b border-border">
					<h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">CLI & Config</h2>
				</div>
				<div className="p-5 grid gap-4 md:grid-cols-2">
					<div>
						<h3 className="text-sm font-medium mb-2">Installation</h3>
						<div className="rounded-md bg-muted p-3">
							<code className="text-xs font-mono">go install github.com/Daviduche03/Runmesh/runmesh-main/workspace/cmd/runmesh@latest</code>
						</div>
					</div>
					<div>
						<h3 className="text-sm font-medium mb-2">Quick start</h3>
						<div className="rounded-md bg-muted p-3 grid gap-1">
							<code className="text-xs font-mono">runmesh config set --bucket my-bucket --endpoint https://...</code>
							<code className="text-xs font-mono">cd ~/code/my-project && runmesh workspace link</code>
							<code className="text-xs font-mono">runmesh workspace watch</code>
						</div>
					</div>
				</div>
			</div>

			<Modal open={showLinkModal} onClose={() => { setShowLinkModal(false); setLinkError(""); }} title="Link project">
				<form onSubmit={handleLinkProject} className="grid gap-5">
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Project prefix</label>
						<Input placeholder="e.g. my-project" value={linkPrefix} onChange={(e) => setLinkPrefix(e.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Bucket name</label>
						<Input placeholder="e.g. my-bucket" value={linkBucket} onChange={(e) => setLinkBucket(e.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<label className="text-sm font-medium">Local path (optional)</label>
						<Input placeholder="e.g. /home/user/projects/my-project" value={linkPath} onChange={(e) => setLinkPath(e.target.value)} />
					</div>
					{linkError && <p className="text-sm text-red-400">{linkError}</p>}
					<div className="flex justify-end gap-3 pt-2 border-t border-border">
						<Button type="button" variant="outline" onClick={() => { setShowLinkModal(false); setLinkError(""); }}>Cancel</Button>
						<Button type="submit" disabled={linking}>
							{linking && <Loader2Icon className="size-4 animate-spin me-1.5" />}
							Link project
						</Button>
					</div>
				</form>
			</Modal>

			<Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Unlink project">
				<div className="grid gap-5">
					<p className="text-sm text-muted-foreground">
						Are you sure you want to unlink <span className="font-medium text-foreground">{deleteTarget?.prefix}</span>?
						Files in the cloud bucket will not be deleted, but the link will be removed.
					</p>
					<div className="flex justify-end gap-3 pt-2 border-t border-border">
						<Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
						<Button variant="destructive" onClick={handleDeleteProject} disabled={deleting}>
							{deleting && <Loader2Icon className="size-4 animate-spin me-1.5" />}
							Unlink
						</Button>
					</div>
				</div>
			</Modal>
		</div>
	)
}
