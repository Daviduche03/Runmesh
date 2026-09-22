import { Link, useSearchParams } from "react-router-dom"
import { AuthLayout } from "@/modules/auth/auth-layout"
import { useState } from "react"

const API_BASE = import.meta.env.VITE_API_URL ?? ""

export function Signup() {
	const [params] = useSearchParams()
	const [loading, setLoading] = useState(false)
	const redirectTo = params.get("redirect_to") || ""

	const handleGitHubLogin = async () => {
		setLoading(true)
		try {
			const url = redirectTo
				? `${API_BASE}/auth/github/login?redirect_to=${encodeURIComponent(redirectTo)}`
				: `${API_BASE}/auth/github/login`
			const res = await fetch(url)
			const body = await res.json()
			if (body.ok && body.data?.url) {
				// CSRF protection: the callback must return this exact state
				if (body.data?.state) {
					localStorage.setItem("runmesh-oauth-state", body.data.state)
				}
				window.location.href = body.data.url
			}
		} catch {
			setLoading(false)
		}
	}

	return (
		<AuthLayout
			title="Create your control room"
			subtitle="Start operating agents with identity, access, and audit."
			loading={loading}
			onGitHub={handleGitHubLogin}
			footer={
				<>
					Already have an account?{" "}
					<Link
						to="/login"
						className="text-[var(--rm-fg)] no-underline underline-offset-4 hover:underline"
					>
						Log in
					</Link>
				</>
			}
		/>
	)
}
