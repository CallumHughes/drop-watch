"use client";

import { APP_NAME } from "@drop-watch/brand";
import { Mark, Wordmark } from "@drop-watch/brand/components/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@drop-watch/ui/components/sidebar";
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
                <Mark className="h-5! w-auto!" />
              </div>
              {/* The menu button sizes every descendant svg to 16 square, which
                  letterboxes a 5.4:1 wordmark down to a smudge. */}
              <Wordmark className="h-4! w-auto!" />
              {/* The wordmark is artwork, and the label is hidden with it when
                  the rail collapses, so the link keeps a name of its own. */}
              <span className="sr-only">{APP_NAME}</span>
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
