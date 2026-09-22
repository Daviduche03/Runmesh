"use client";

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/segmented-control";
import { FormSelect } from "@/components/form-select";
import { OnboardingGraphic } from "@/modules/onboarding/onboarding-graphic";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";

type Invite = { email: string; role: "member" | "admin" };
type WorkspaceType = "personal" | "work";

const NAME_MAX = 64;
const MAX_INVITES = 20; // mirrors the server cap
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Client-side validation mirrors the server's; the server remains the
// authority, this is only for fast feedback.
function validateName(name: string) {
	const value = name.trim();
	if (!value) return "A workspace name is required.";
	if (value.length > NAME_MAX) return `Keep it under ${NAME_MAX} characters.`;
	return "";
}
function validateSlug(slug: string) {
	if (!slug) return "";
	return SLUG_RE.test(slug) ? "" : "2–48 lowercase letters, numbers, or hyphens.";
}

export function OnboardingPage() {
	const navigate = useNavigate();
	const [checking, setChecking] = useState(true);

	const [name, setName] = useState("");
	const [type, setType] = useState<WorkspaceType>("personal");
	const [slug, setSlug] = useState("");
	const [seats, setSeats] = useState("1");
	const [invites, setInvites] = useState<Invite[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState("");

	// Already onboarded? Skip straight in. (The endpoint is idempotent, but
	// there's no reason to show first-run to an existing account.)
	useEffect(() => {
		let active = true;
		apiGet<unknown>("/api/v1/workspaces")
			.then((res) => {
				if (!active) return;
				const items = Array.isArray(res.data) ? res.data : [];
				if (items.length > 0) navigate("/dashboard", { replace: true });
				else setChecking(false);
			})
			.catch(() => {
				if (active) setChecking(false);
			});
		return () => {
			active = false;
		};
	}, [navigate]);

	const nameError = validateName(name);
	const slugError = validateSlug(slug);
	const inviteErrors = invites.map((invite) =>
		!invite.email.trim() ? "" : EMAIL_RE.test(invite.email.trim()) ? "" : "Enter a valid email."
	);
	const canSubmit =
		!submitting && !nameError && !slugError && inviteErrors.every((message) => !message);

	const updateInvite = (index: number, patch: Partial<Invite>) =>
		setInvites((prev) => prev.map((invite, i) => (i === index ? { ...invite, ...patch } : invite)));

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!canSubmit) return;
		setError("");

		// Build the payload from validated values only. Never trust the client
		// for authority — this is a request, the server decides.
		const payload: Record<string, unknown> = {
			name: name.trim(),
			type,
			seats: type === "personal" ? 1 : Math.max(1, Math.min(500, Number(seats) || 1)),
		};
		if (slug) payload.slug = slug.trim().toLowerCase();
		if (type === "work") {
			const clean = invites
				.filter((invite) => invite.email.trim())
				.slice(0, MAX_INVITES)
				.map((invite) => ({ email: invite.email.trim().toLowerCase(), role: invite.role }));
			if (clean.length) payload.invites = clean;
		}

		setSubmitting(true);
		try {
			await apiPost("/api/v1/workspaces/onboard", payload);
			navigate("/dashboard", { replace: true });
		} catch (err) {
			setError(err instanceof ApiError ? err.message : "Couldn't create your workspace. Try again.");
			setSubmitting(false);
		}
	};

	if (checking) {
		return (
			<main className="rm-surface grid min-h-screen place-items-center bg-[var(--rm-bg)]">
				<Loader2Icon className="size-5 animate-spin text-[var(--rm-muted)]" />
			</main>
		);
	}

	return (
		<main className="rm-surface min-h-screen bg-[var(--rm-bg)] font-sans text-[var(--rm-fg)] antialiased">
			<div className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
				{/* illustration */}
				<div className="hidden flex-col justify-between border-r border-[var(--rm-line)] p-10 lg:flex xl:p-14">
					<Link to="/" className="flex w-fit items-center gap-2.5 text-[15px] font-medium no-underline">
						<span className="size-2.5 rounded-full bg-[var(--rm-accent)]" />
						<span className="font-display">Runmesh</span>
					</Link>
					<div className="flex flex-1 items-center">
						<OnboardingGraphic />
					</div>
					<p className="max-w-[420px] text-[14px] leading-6 text-[var(--rm-muted)]">
						Your agents ask. Runmesh checks identity, access, and control — then lets the action through and
						records it. Set up the workspace that holds all three.
					</p>
				</div>

				{/* form */}
				<div className="flex min-h-screen justify-center px-6 py-12">
					<form className="my-auto w-full max-w-[440px]" onSubmit={submit} noValidate>
						<div className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--rm-faint)]">
							Step 1 of 1
						</div>
						<h1 className="mt-3 font-display text-[clamp(24px,3.4vw,32px)] font-medium leading-tight tracking-[-0.03em]">
							Create your workspace
						</h1>
						<p className="mt-2 text-[15px] leading-6 text-[var(--rm-muted)]">
							This is where your agents, grants, and audit live. You can rename it later.
						</p>

						<div className="mt-8 grid gap-4">
							<label className="grid gap-1.5">
								<span className="text-[12px] text-[var(--rm-muted)]">Workspace name</span>
								<Input
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="Acme"
									autoFocus
									maxLength={NAME_MAX + 8}
									autoComplete="organization"
									aria-invalid={!!nameError}
								/>
								{nameError ? <span className="text-[12px] text-[var(--rm-accent)]">{nameError}</span> : null}
							</label>

							<div className="grid gap-1.5">
								<span className="text-[12px] text-[var(--rm-muted)]">Who's it for?</span>
								<SegmentedControl
									options={[
										{ label: "Just me", value: "personal" },
										{ label: "My team", value: "work" },
									]}
									value={type}
									onChange={(value) => setType(value)}
								/>
							</div>

							<label className="grid gap-1.5">
								<span className="text-[12px] text-[var(--rm-muted)]">Slug (optional)</span>
								<Input
									value={slug}
									onChange={(e) => setSlug(e.target.value.toLowerCase())}
									placeholder="acme"
									maxLength={48}
									aria-invalid={!!slugError}
								/>
								{slugError ? (
									<span className="text-[12px] text-[var(--rm-accent)]">{slugError}</span>
								) : (
									<span className="text-[11px] text-[var(--rm-faint)]">Used in URLs and package names.</span>
								)}
							</label>

							{type === "work" ? (
								<>
									<label className="grid gap-1.5">
										<span className="text-[12px] text-[var(--rm-muted)]">Seats</span>
										<Input
											type="number"
											min={1}
											max={500}
											value={seats}
											onChange={(e) => setSeats(e.target.value)}
											className="max-w-28"
										/>
									</label>

									<div className="grid gap-2">
										<div className="flex items-center justify-between">
											<span className="text-[12px] text-[var(--rm-muted)]">Invite teammates</span>
											<span className="font-mono text-[11px] text-[var(--rm-faint)]">
												{invites.length}/{MAX_INVITES}
											</span>
										</div>
										{invites.map((invite, index) => (
											<div className="grid grid-cols-[1fr_120px_auto] items-start gap-2" key={index}>
												<div className="grid gap-1">
													<Input
														type="email"
														value={invite.email}
														onChange={(e) => updateInvite(index, { email: e.target.value })}
														placeholder="teammate@acme.dev"
														autoComplete="off"
														aria-invalid={!!inviteErrors[index]}
													/>
													{inviteErrors[index] ? (
														<span className="text-[11px] text-[var(--rm-accent)]">{inviteErrors[index]}</span>
													) : null}
												</div>
												<FormSelect
													value={invite.role}
													onChange={(role) => updateInvite(index, { role })}
													options={[
														{ label: "Member", value: "member" },
														{ label: "Admin", value: "admin" },
													]}
												/>
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													onClick={() => setInvites((prev) => prev.filter((_, i) => i !== index))}
													aria-label="Remove invite"
												>
													<Trash2Icon className="size-4 text-[var(--rm-muted)]" />
												</Button>
											</div>
										))}
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="w-fit"
											disabled={invites.length >= MAX_INVITES}
											onClick={() => setInvites((prev) => [...prev, { email: "", role: "member" }])}
										>
											<PlusIcon className="me-1.5 size-3.5" />
											Add invite
										</Button>
									</div>
								</>
							) : null}
						</div>

						{error ? (
							<p className="mt-5 rounded-[4px] border border-[var(--rm-accent)]/40 bg-[var(--rm-accent)]/10 px-3 py-2 text-[13px] text-[var(--rm-accent)]">
								{error}
							</p>
						) : null}

						<Button type="submit" size="lg" className="mt-8 w-full" disabled={!canSubmit}>
							{submitting ? <Loader2Icon className="me-1.5 size-4 animate-spin" /> : null}
							{submitting ? "Creating workspace…" : "Create workspace"}
						</Button>

						<p className="mt-4 text-center text-[12px] text-[var(--rm-faint)]">
							Already set up?{" "}
							<Link to="/dashboard" className="text-[var(--rm-muted)] no-underline underline-offset-4 hover:underline">
								Go to your control room
							</Link>
						</p>
					</form>
				</div>
			</div>
		</main>
	);
}
