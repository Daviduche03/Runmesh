import { useNavigate } from "react-router-dom"
import { useAuthStore } from "@/lib/stores/auth-store"
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreditCard, Gear, Monitor, Moon, SignOut, Sun, User } from "@phosphor-icons/react";
import { useTheme } from "@/components/theme-provider";

const themeOptions = [
	{ label: "Light", value: "light", icon: Sun },
	{ label: "Dark", value: "dark", icon: Moon },
	{ label: "System", value: "system", icon: Monitor },
] as const;

export function NavUser() {
	const user = useAuthStore((s) => s.user);
	const logout = useAuthStore((s) => s.logout);
	const navigate = useNavigate();
	const { theme, setTheme } = useTheme();
	const name = user?.name ?? "U";
	const email = user?.email ?? "";
	const avatar = user?.avatar_url || undefined;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Avatar className="size-8 outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
					<AvatarImage src={avatar} />
					<AvatarFallback>{name.charAt(0)}</AvatarFallback>
				</Avatar>
			</DropdownMenuTrigger>

			<DropdownMenuContent align="end" className="w-64">
				<DropdownMenuLabel className="px-3 py-3 font-normal">
					<div className="flex items-center gap-3">
						<Avatar size="lg">
							<AvatarImage src={avatar} />
							<AvatarFallback>{name.charAt(0)}</AvatarFallback>
						</Avatar>
						<div className="min-w-0">
							<div className="truncate text-[13px] font-medium leading-5 text-foreground">
								{name}
							</div>
							<div className="truncate text-xs leading-4 text-muted-foreground">
								{email || "Signed in"}
							</div>
						</div>
					</div>
				</DropdownMenuLabel>

				<DropdownMenuSeparator />

				<DropdownMenuGroup className="flex flex-col gap-0.5">
					<DropdownMenuItem className="gap-2.5 px-2 py-1.5" onClick={() => navigate("/settings")}>
						<User className="text-muted-foreground" />
						Account
					</DropdownMenuItem>
					<DropdownMenuItem className="gap-2.5 px-2 py-1.5" onClick={() => navigate("/settings")}>
						<Gear className="text-muted-foreground" />
						Settings
					</DropdownMenuItem>
					<DropdownMenuItem className="gap-2.5 px-2 py-1.5" onClick={() => navigate("/settings")}>
						<CreditCard className="text-muted-foreground" />
						Plan &amp; Billing
					</DropdownMenuItem>
				</DropdownMenuGroup>

				<DropdownMenuSeparator />

				<div className="px-1.5 pt-1.5 pb-1">
					<div className="mb-1.5 text-[11px] font-medium tracking-[0.02em] text-muted-foreground">
						Appearance
					</div>
					<DropdownMenuRadioGroup
						value={theme}
						onValueChange={(value) => setTheme(value as typeof theme)}
						className="flex gap-1"
					>
						{themeOptions.map((option) => (
							<DropdownMenuRadioItem
								key={option.value}
								value={option.value}
								onSelect={(event) => {
									event.preventDefault();
									setTheme(option.value);
								}}
								className="h-8 flex-1 justify-center gap-1.5 rounded-lg pr-1.5 text-xs font-medium text-muted-foreground outline-none data-[state=checked]:bg-muted data-[state=checked]:text-foreground hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 focus-visible:text-foreground [&>span]:hidden"
							>
								<option.icon className="size-3.5" />
								{option.label}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</div>

				<DropdownMenuSeparator />

				<DropdownMenuItem
					variant="destructive"
					className="gap-2.5 px-2 py-1.5"
					onClick={() => {
						logout();
						navigate("/");
					}}
				>
					<SignOut />
					Log out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
