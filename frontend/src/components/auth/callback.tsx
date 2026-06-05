import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/stores/auth-store";

export function Callback() {
	const [params] = useSearchParams();
	const navigate = useNavigate();
	const setToken = useAuthStore((s) => s.setToken);
	const fetchUser = useAuthStore((s) => s.fetchUser);

	useEffect(() => {
		const token = params.get("token");
		if (!token) {
			navigate("/login", { replace: true });
			return;
		}

		setToken(token);
		fetchUser().then(() => {
			navigate("/dashboard", { replace: true });
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<main className="flex min-h-screen items-center justify-center bg-[#08090a]">
			<div className="text-[14px] text-[#8f949e]">Signing you in...</div>
		</main>
	);
}
