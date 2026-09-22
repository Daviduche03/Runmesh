import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/lib/stores/auth-store";

export function RequireAuth() {
	const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
	if (!isAuthenticated) {
		return <Navigate to="/login" replace />;
	}
	return <Outlet />;
}
