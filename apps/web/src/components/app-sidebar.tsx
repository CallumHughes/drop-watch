"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@price-tracker/ui/components/sidebar";
import { ChartLineIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";

/** The signed-in user, resolved server-side by the (app) layout. */
export interface SidebarUser {
  email: string;
  image: string | null;
  isAdmin: boolean;
  name: string;
}

export function AppSidebar({
  user,
  ...props
}: ComponentProps<typeof Sidebar> & { user: SidebarUser }) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/" />} size="lg">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <ChartLineIcon className="size-4" />
              </div>
              <span className="truncate font-medium">Price Tracker</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain isAdmin={user.isAdmin} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
