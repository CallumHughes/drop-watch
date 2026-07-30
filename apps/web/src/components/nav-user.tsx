"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@drop-watch/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@drop-watch/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@drop-watch/ui/components/sidebar";
import { ChevronsUpDownIcon, LogOutIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import type { SidebarUser } from "@/components/app-sidebar";
import { authClient } from "@/lib/auth-client";

function UserBadge({ user }: { user: SidebarUser }) {
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <Avatar>
        {user.image ? <AvatarImage alt={user.name} src={user.image} /> : null}
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.name}</span>
        <span className="truncate text-xs">{user.email}</span>
      </div>
    </>
  );
}

export function NavUser({ user }: { user: SidebarUser }) {
  const { isMobile } = useSidebar();
  const router = useRouter();

  const handleSignOut = useCallback(() => {
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          // Straight to /login — "/" is the dashboard now, and landing there
          // signed out would only bounce through its guard anyway.
          router.push("/login");
        },
      },
    });
  }, [router]);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton className="aria-expanded:bg-muted" size="lg" />}
          >
            <UserBadge user={user} />
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-fit min-w-56"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <UserBadge user={user} />
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {/* The only way to reach /account — it is deliberately absent
                  from the sidebar nav, which is for the tracker, not for the
                  account. */}
              <DropdownMenuItem render={<Link href="/account" />}>
                <UserIcon />
                Account
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} variant="destructive">
              <LogOutIcon />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
