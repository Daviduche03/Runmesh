import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet } from "@/lib/api"
import { FolderOpenIcon, TerminalIcon, RefreshCwIcon, PlusIcon, ExternalLinkIcon } from "lucide-react"

type Project = {
	id: string
	prefix: string
	bucket: string
	local_path: string | null
	last_synced_at: string | null
}

export function WorkspacePage() {
	const [projects, setProjects] = useState<Project[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		apiGet<Project[]>("/api/workspace/projects")
			.then((res) => setProjects(res.data ?? []))
			.catch(() => setProjects([]))
			.finally(() => setLoading(false))
	}, [])

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-[24px] font-[590] tracking-[-0.03em] text-foreground">Workspace</h1>
					<p className="mt-1 text-[14px] text-muted-foreground">
						Manage your cloud-synced projects
					</p>
				</div>
				<Button asChild className="gap-2">
					<Link to="/workspace">
						<PlusIcon className="size-4" />
						Link project
					</Link>
				</Button>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-[13px] font-medium text-muted-foreground">Linked projects</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-[28px] font-[590] tabular-nums">{loading ? "..." : projects.length}</p>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-[13px] font-medium text-muted-foreground">CLI status</CardTitle>
					</CardHeader>
					<CardContent className="flex items-center gap-2">
						<span className="size-2 rounded-full bg-[#4cb782]" />
						<span className="text-[14px] text-foreground">Authenticated</span>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-[13px] font-medium text-muted-foreground">Quick start</CardTitle>
					</CardHeader>
					<CardContent>
						<Button variant="outline" size="sm" className="gap-2 text-[13px]" asChild>
							<a href="https://github.com/daviduche03/Continuumm" target="_blank" rel="noreferrer">
								<ExternalLinkIcon className="size-3.5" />
								Install CLI
							</a>
						</Button>
					</CardContent>
				</Card>
			</div>

			<div className="rounded-lg border border-border">
				<div className="flex items-center justify-between border-b border-border px-6 py-3">
					<h2 className="text-[15px] font-medium text-foreground">Linked projects</h2>
					{projects.length > 0 && (
						<Button variant="ghost" size="sm" className="gap-2 text-[13px] text-muted-foreground">
							<RefreshCwIcon className="size-3.5" />
							Sync all
						</Button>
					)}
				</div>
				{loading ? (
					<div className="flex items-center justify-center py-16">
						<div className="text-[14px] text-muted-foreground">Loading...</div>
					</div>
				) : projects.length === 0 ? (
					<div className="flex flex-col items-center gap-3 py-16">
						<TerminalIcon className="size-10 text-muted-foreground" />
						<p className="text-[14px] text-muted-foreground">No projects linked yet</p>
						<p className="max-w-[480px] text-center text-[13px] text-muted-foreground">
							Install the CLI, configure your credentials, and run{" "}
							<code className="rounded bg-muted px-1.5 py-0.5 text-[13px]">continuumm link</code>{" "}
							in a project directory.
						</p>
						<Button variant="outline" size="sm" className="mt-2 gap-2">
							<ExternalLinkIcon className="size-3.5" />
							View documentation
						</Button>
					</div>
				) : (
					<div className="divide-y divide-border">
						{projects.map((p) => (
							<div key={p.id} className="flex items-center justify-between px-6 py-4">
								<div className="flex items-center gap-4">
									<div className="grid size-9 place-items-center rounded-lg border border-border bg-muted">
										<FolderOpenIcon className="size-4 text-muted-foreground" />
									</div>
									<div>
										<p className="text-[14px] font-medium text-foreground">{p.prefix}</p>
										<p className="text-[12px] text-muted-foreground">
											{p.bucket}/{p.prefix}
											{p.local_path && <> &middot; {p.local_path}</>}
										</p>
									</div>
								</div>
								<div className="flex items-center gap-2">
									{p.last_synced_at && (
										<span className="text-[12px] text-muted-foreground">
											{p.last_synced_at}
										</span>
									)}
									<Button variant="ghost" size="icon" className="size-8">
										<RefreshCwIcon className="size-3.5" />
									</Button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	)
}
