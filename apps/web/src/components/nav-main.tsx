"use client";

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@drop-watch/ui/components/sidebar";
import { LayoutDashboardIcon, PlusIcon, Settings2Icon, UserPlusIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", icon: LayoutDashboardIcon, title: "Dashboard" },
  { href: "/products/new", icon: PlusIcon, title: "Add product" },
  { href: "/settings", icon: Settings2Icon, title: "Settings" },
] as const;

export function NavMain({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Tracker</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              isActive={pathname === item.href}
              render={<Link href={item.href} />}
              tooltip={item.title}
            >
              <item.icon />
              <span>{item.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
        {/* Admin-only, but hiding it is presentation — the page and every
            invites procedure re-check the role server-side. */}
        {isAdmin ? (
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname === "/invites"}
              render={<Link href="/invites" />}
              tooltip="Invites"
            >
              <UserPlusIcon />
              <span>Invites</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
    </SidebarGroup>
  );
}
