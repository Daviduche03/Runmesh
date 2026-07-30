import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/auth-store";

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const STATE_KEY = "runmesh-oauth-state";

export function Callback() {
	const [params] = useSearchParams();
	const navigate = useNavigate();
	const setToken = useAuthStore((s) => s.setToken);
	const fetchUser = useAuthStore((s) => s.fetchUser);

	useEffect(() => {
		const code = params.get("code");
		const state = params.get("state") || "";

		// CSRF check: the returned state must match the one we stored before
		// redirecting to GitHub. A login flow initiated by an attacker won't match.
		const expectedState = localStorage.getItem(STATE_KEY);
		localStorage.removeItem(STATE_KEY);
		if (!code || !state || !expectedState || state !== expectedState) {
			navigate("/login", { replace: true });
			return;
		}

		// Only allow in-app paths as post-login targets
		const rawRedirect = params.get("redirect_to") || "/dashboard";
		const redirectTo = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/dashboard";

		// Exchange the short-lived code for a session token (token never in URL)
		fetch(`${API_BASE}/auth/exchange`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code }),
		})
			.then((res) => res.json())
			.then((body) => {
				const token = body?.data?.token;
				if (!body?.ok || !token) {
					navigate("/login", { replace: true });
					return;
				}
				setToken(token);
				fetchUser().then(() => {
					navigate(redirectTo, { replace: true });
				});
			})
			.catch(() => navigate("/login", { replace: true }));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<main className="flex min-h-screen items-center justify-center bg-[#08090a]">
			<div className="text-[14px] text-[#8f949e]">Signing you in...</div>
		</main>
	);
}
