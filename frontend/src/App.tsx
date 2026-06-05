import { Routes, Route, Navigate } from "react-router-dom"
import { LinearLanding } from "@/components/landing-page"
import { Login } from "@/components/auth/login"
import { Signup } from "@/components/auth/signup"
import { Callback } from "@/components/auth/callback"
import { AppShell } from "@/components/app-shell"
import { Dashboard } from "@/components/pages/dashboard"
import { RunsPage } from "@/components/pages/runs"
import { WorkflowsPage } from "@/components/pages/workflows"
import { WorkflowDetailPage } from "@/components/pages/workflow-detail"
import { SettingsPage } from "@/components/pages/settings"
import { useAuthStore } from "@/stores/auth-store"

function ProtectedRoute({ children }: { children: React.ReactNode }) {
	const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
	if (!isAuthenticated) {
		return <Navigate to="/login" replace />;
	}
	return <>{children}</>;
}

export function App() {
	return (
		<Routes>
			<Route path="/" element={<LinearLanding />} />
			<Route path="/login" element={<Login />} />
			<Route path="/signup" element={<Signup />} />
			<Route path="/auth/callback" element={<Callback />} />
			<Route
				path="/dashboard"
				element={
					<ProtectedRoute>
						<AppShell>
							<Dashboard />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/runs"
				element={
					<ProtectedRoute>
						<AppShell>
							<RunsPage />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/workflows/:workflowId"
				element={
					<ProtectedRoute>
						<AppShell>
							<WorkflowDetailPage />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/workflows"
				element={
					<ProtectedRoute>
						<AppShell>
							<WorkflowsPage />
						</AppShell>
					</ProtectedRoute>
				}
			/>
			<Route
				path="/settings"
				element={
					<ProtectedRoute>
						<AppShell>
							<SettingsPage />
						</AppShell>
					</ProtectedRoute>
				}
			/>
		</Routes>
	)
}

export default App
