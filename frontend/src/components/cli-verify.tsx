import { useState } from "react"
import { useSearchParams, Link } from "react-router-dom"
import { useAuthStore } from "@/stores/auth-store"
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
			<main className="flex min-h-screen items-center justify-center bg-[#08090a]">
				<div className="max-w-[440px] p-10 text-center">
					<h1 className="text-[24px] font-[600] text-white">Invalid Link</h1>
					<p className="mt-2 text-[#969799]">No verification code provided. Run <code className="rounded bg-[#1c1c1c] px-1.5 py-0.5">runmesh login</code> again.</p>
				</div>
			</main>
		)
	}

	return (
		<main className="flex min-h-screen items-center justify-center bg-[#08090a]">
			<div className="max-w-[480px] p-10 text-center">
				<LogoIcon className="mx-auto mb-6 size-8 text-white" />
				<h1 className="text-[24px] font-[600] text-white">Confirm Runmesh CLI login</h1>
				<p className="mt-2 text-[#969799]">A CLI session is requesting access to your Runmesh account.</p>

				<div className="mx-auto my-6 inline-block rounded-xl border border-[#23252a] bg-[#1c1c1c] px-7 py-5 font-mono text-[36px] tracking-[0.15em] text-white">
					{code}
				</div>

				<p className="text-[13px] text-[#595a5c]">If this code matches your terminal, confirm below.</p>

				{isAuthenticated ? (
					<div className="mt-6">
						<Button
							onClick={handleConfirm}
							disabled={confirming}
							className="h-11 px-8 bg-[#f2f2f2] text-[15px] font-medium text-[#08090a] hover:bg-white"
						>
							{confirming ? "Confirming..." : "Confirm"}
						</Button>
					</div>
				) : (
					<div className="mt-6">
						<Button asChild className="h-11 px-8 bg-[#f2f2f2] text-[15px] font-medium text-[#08090a] hover:bg-white">
							<Link to={`/login?redirect_to=${encodeURIComponent(redirectTo)}`}>
								Sign in with GitHub
							</Link>
						</Button>
					</div>
				)}

				{status && (
					<p className="mt-4 text-[14px] text-[#969799]">{status}</p>
				)}
			</div>
		</main>
	)
}
