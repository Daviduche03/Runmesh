import { useState } from "react"
import { useSearchParams, Link } from "react-router-dom"
import { useAuthStore } from "@/lib/stores/auth-store"
import { Button } from "@/components/ui/button"
import { LogoIcon } from "@/components/logo"

const API_BASE = import.meta.env.VITE_API_URL ?? ""

export function CliVerify() {
	const [params] = useSearchParams()
	const code = params.get("code") || ""
	const { isAuthenticated, token } = useAuthStore()
	const [status, setStatus] = useState<string>("")
	const [confirming, setConfirming] = useState(false)

	const redirectTo = `/cli/verify?code=${encodeURIComponent(code)}`

	const handleConfirm = async () => {
		if (!token) {
			setStatus("Not authenticated. Please sign in first.")
			return
		}
		setConfirming(true)
		try {
			const res = await fetch(`${API_BASE}/auth/cli/confirm`, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
				body: JSON.stringify({ user_code: code }),
			})
			const body = await res.json()
			if (body.ok) {
				setStatus("Confirmed! You can close this tab.")
			} else {
				setStatus(body.error?.message || "Confirmation failed")
			}
		} catch {
			setStatus("Network error")
		} finally {
			setConfirming(false)
		}
	}

	if (!code) {
		return (
			<main className="flex min-h-screen items-center justify-center bg-background font-sans text-foreground">
				<div className="max-w-[440px] p-10 text-center">
					<h1 className="font-display text-[24px] font-medium tracking-[-0.02em]">Invalid link</h1>
					<p className="mt-2 text-[15px] text-muted-foreground">
						No verification code provided. Run{" "}
						<code className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[13px]">runmesh login</code>{" "}
						again.
					</p>
				</div>
			</main>
		)
	}

	return (
		<main className="flex min-h-screen items-center justify-center bg-background font-sans text-foreground">
			<div className="max-w-[480px] p-10 text-center">
				<LogoIcon className="mx-auto mb-6 size-8 text-primary" />
				<h1 className="font-display text-[24px] font-medium tracking-[-0.02em]">Confirm Runmesh CLI login</h1>
				<p className="mt-2 text-[15px] text-muted-foreground">
					A CLI session is requesting access to your Runmesh account.
				</p>

				<div className="mx-auto my-6 inline-block rounded-[6px] border border-border bg-muted px-7 py-5 font-mono text-[36px] tracking-[0.15em] text-foreground">
					{code}
				</div>

				<p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
					If this code matches your terminal, confirm below
				</p>

				{status && <p className="mt-4 text-[14px] text-muted-foreground">{status}</p>}

				<div className="mt-6">
					{isAuthenticated ? (
						<Button onClick={handleConfirm} disabled={confirming} className="h-10 px-6 text-[14px]">
							{confirming ? "Confirming..." : "Confirm"}
						</Button>
					) : (
						<Button asChild className="h-10 px-6 text-[14px]">
							<Link to={`/login?redirect_to=${encodeURIComponent(redirectTo)}`}>Sign in with GitHub</Link>
						</Button>
					)}
				</div>
			</div>
		</main>
	)
}
