import { lazy, Suspense } from "react"
import { createBrowserRouter, RouterProvider } from "react-router-dom"
import { SmoothScroll } from "@/components/smooth-scroll"
import { AppToaster } from "@/components/app-toaster"
import { LinearLanding } from "@/modules/landing/landing.page"
import { Skeleton } from "@/components/ui/skeleton"

/* Route-level code splitting.

   The landing page is the entry point for most visitors and stays eager so
   there is no waterfall before first paint. Everything else — the app shell,
   every dashboard page, auth — is split, so a marketing visitor never
   downloads the dashboard (recharts, react-flow) and the app shell never
   pulls the landing page in.

   Without this the whole app was one 1.5 MB chunk loaded on every route. */

const WorkspaceLanding = lazy(() =>
	import("@/modules/workspace-landing/workspace-landing.page").then((m) => ({
		default: m.WorkspaceLanding,
	}))
)
const CliVerify = lazy(() =>
	import("@/modules/auth/cli-verify.page").then((m) => ({ default: m.CliVerify }))
)
const Login = lazy(() => import("@/modules/auth/login.page").then((m) => ({ default: m.Login })))
const Signup = lazy(() => import("@/modules/auth/signup.page").then((m) => ({ default: m.Signup })))
const Callback = lazy(() =>
	import("@/modules/auth/callback.page").then((m) => ({ default: m.Callback }))
)
const RequireAuth = lazy(() =>
	import("@/modules/auth/require-auth").then((m) => ({ default: m.RequireAuth }))
)
const AppShell = lazy(() =>
	import("@/components/layout/app-shell").then((m) => ({ default: m.AppShell }))
)
const Dashboard = lazy(() =>
	import("@/modules/dashboard/dashboard.page").then((m) => ({ default: m.Dashboard }))
)
const OnboardingPage = lazy(() =>
	import("@/modules/onboarding/onboarding.page").then((m) => ({ default: m.OnboardingPage }))
)
const WorkspacePage = lazy(() =>
	import("@/modules/workspace/workspace.page").then((m) => ({ default: m.WorkspacePage }))
)
const RunsPage = lazy(() =>
	import("@/modules/runs/runs.page").then((m) => ({ default: m.RunsPage }))
)
const WorkflowsPage = lazy(() =>
	import("@/modules/workflows/workflows.page").then((m) => ({ default: m.WorkflowsPage }))
)
const WorkflowDetailPage = lazy(() =>
	import("@/modules/workflows/workflow-detail.page").then((m) => ({
		default: m.WorkflowDetailPage,
	}))
)
const SettingsPage = lazy(() =>
	import("@/modules/settings/settings.page").then((m) => ({ default: m.SettingsPage }))
)
const ConnectPage = lazy(() =>
	import("@/modules/connect/connect.page").then((m) => ({ default: m.ConnectPage }))
)
const PoliciesPage = lazy(() =>
	import("@/modules/policies/policies.page").then((m) => ({ default: m.PoliciesPage }))
)
const PolicySimulationPage = lazy(() =>
	import("@/modules/policies/policy-simulation.page").then((m) => ({
		default: m.PolicySimulationPage,
	}))
)
const PolicyChangelogPage = lazy(() =>
	import("@/modules/policies/policy-changelog.page").then((m) => ({
		default: m.PolicyChangelogPage,
	}))
)
const AuditPage = lazy(() =>
	import("@/modules/audit/audit.page").then((m) => ({ default: m.AuditPage }))
)
const AuditThreadPage = lazy(() =>
	import("@/modules/audit/audit-thread.page").then((m) => ({ default: m.AuditThreadPage }))
)
const GrantsPage = lazy(() =>
	import("@/modules/grants/grants.page").then((m) => ({ default: m.GrantsPage }))
)
const AgentsPage = lazy(() =>
	import("@/modules/agents/agents.page").then((m) => ({ default: m.AgentsPage }))
)
const AgentDetailPage = lazy(() =>
	import("@/modules/agents/agent-detail.page").then((m) => ({ default: m.AgentDetailPage }))
)

const router = createBrowserRouter([
	{
		path: "/",
		element: (
			<SmoothScroll>
				<LinearLanding />
			</SmoothScroll>
		),
	},
	{
		path: "/workspace",
		element: (
			<SmoothScroll>
				<WorkspaceLanding />
			</SmoothScroll>
		),
	},
	{ path: "/cli/verify", element: <CliVerify /> },
	{ path: "/login", element: <Login /> },
	{ path: "/signup", element: <Signup /> },
	{ path: "/auth/callback", element: <Callback /> },
	{
		element: <RequireAuth />,
		children: [
			{ path: "/onboarding", element: <OnboardingPage /> },
			{
				element: <AppShell />,
				children: [
					{ path: "/dashboard", element: <Dashboard /> },
					{ path: "/app/workspace", element: <WorkspacePage /> },
					{ path: "/agents", element: <AgentsPage /> },
					{ path: "/agents/:id", element: <AgentDetailPage /> },
					{ path: "/grants", element: <GrantsPage /> },
					{ path: "/audit", element: <AuditPage /> },
					{ path: "/audit/threads/:threadId", element: <AuditThreadPage /> },
					{ path: "/policies", element: <PoliciesPage /> },
					{ path: "/policies/simulation", element: <PolicySimulationPage /> },
					{ path: "/policies/changelog", element: <PolicyChangelogPage /> },
					{ path: "/runs", element: <RunsPage /> },
					{ path: "/workflows", element: <WorkflowsPage /> },
					{ path: "/workflows/:workflowId", element: <WorkflowDetailPage /> },
					{ path: "/settings", element: <SettingsPage /> },
					{ path: "/connect", element: <ConnectPage /> },
				],
			},
		],
	},
])

function RouteFallback() {
	return (
		<div className="flex min-h-screen flex-col gap-4 bg-background p-8">
			<Skeleton className="h-8 w-52" />
			<Skeleton className="h-4 w-80" />
			<Skeleton className="h-40 w-full" />
		</div>
	)
}

export function AppRouter() {
	return (
		<>
			<Suspense fallback={<RouteFallback />}>
				<RouterProvider router={router} />
			</Suspense>
			<AppToaster />
		</>
	)
}
