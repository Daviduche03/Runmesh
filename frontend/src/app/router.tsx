import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { SmoothScroll } from "@/components/smooth-scroll";
import { AppToaster } from "@/components/app-toaster";
import { LinearLanding } from "@/modules/landing/landing.page";
import { WorkspaceLanding } from "@/modules/workspace-landing/workspace-landing.page";
import { CliVerify } from "@/modules/auth/cli-verify.page";
import { Login } from "@/modules/auth/login.page";
import { Signup } from "@/modules/auth/signup.page";
import { Callback } from "@/modules/auth/callback.page";
import { RequireAuth } from "@/modules/auth/require-auth";
import { AppShell } from "@/components/layout/app-shell";
import { Dashboard } from "@/modules/dashboard/dashboard.page";
import { OnboardingPage } from "@/modules/onboarding/onboarding.page";
import { WorkspacePage } from "@/modules/workspace/workspace.page";
import { RunsPage } from "@/modules/runs/runs.page";
import { WorkflowsPage } from "@/modules/workflows/workflows.page";
import { WorkflowDetailPage } from "@/modules/workflows/workflow-detail.page";
import { SettingsPage } from "@/modules/settings/settings.page";
import { ConnectPage } from "@/modules/connect/connect.page";
import { PoliciesPage } from "@/modules/policies/policies.page";
import { PolicySimulationPage } from "@/modules/policies/policy-simulation.page";
import { PolicyChangelogPage } from "@/modules/policies/policy-changelog.page";
import { AuditPage } from "@/modules/audit/audit.page";
import { AuditThreadPage } from "@/modules/audit/audit-thread.page";
import { GrantsPage } from "@/modules/grants/grants.page";
import { AgentsPage } from "@/modules/agents/agents.page";
import { AgentDetailPage } from "@/modules/agents/agent-detail.page";

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
]);

export function AppRouter() {
	return (
		<>
			<RouterProvider router={router} />
			<AppToaster />
		</>
	);
}
