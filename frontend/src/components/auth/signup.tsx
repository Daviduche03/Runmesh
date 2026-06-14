import { Link } from "react-router-dom"
import { LogoIcon } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { AuthVisualPanel } from "@/components/auth/auth-visual-panel"
import { useState } from "react"

const API_BASE = import.meta.env.VITE_API_URL ?? ""

export function Signup() {
	const [loading, setLoading] = useState(false)

	const handleGitHubLogin = async () => {
		setLoading(true)
		try {
			const res = await fetch(`${API_BASE}/auth/github/login`)
			const body = await res.json()
			if (body.ok && body.data?.url) {
				window.location.href = body.data.url
			}
		} catch {
			setLoading(false)
		}
	}

	return (
		<main className="min-h-screen bg-[#08090a] text-white">
			<div className="flex min-h-screen flex-col lg:flex-row">
				<AuthVisualPanel />

				<div className="flex min-h-screen flex-1 items-center justify-center px-6 py-12">
					<div className="w-full max-w-[400px]">
						<div className="mb-8">
							<LogoIcon className="mb-5 size-7" />
							<h1 className="text-[clamp(24px,4vw,28px)] font-[590] leading-tight tracking-[-0.04em] text-white">
								Create your account
							</h1>
							<p className="mt-2 text-[15px] leading-6 text-[#8f949e]">
								Start building with Runmesh in minutes.
							</p>
						</div>

						<Button
							onClick={handleGitHubLogin}
							disabled={loading}
							className="h-11 w-full bg-[#f2f2f2] text-sm font-medium text-[#08090a] hover:bg-white"
						>
							<svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
								<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
							</svg>
							{loading ? "Redirecting..." : "Continue with GitHub"}
						</Button>

						<div className="mt-6 text-center text-sm text-[#8f949e]">
							Already have an account?{" "}
							<Link to="/login" className="text-[#d8dce3] no-underline transition-colors hover:text-white">
								Log in
							</Link>
						</div>

						<div className="mt-8 border-t border-[#24272d] pt-4 text-center">
							<Link to="/" className="text-sm text-[#8f949e] no-underline transition-colors hover:text-white">
								← Back to home
							</Link>
						</div>
					</div>
				</div>
			</div>
		</main>
	)
}
