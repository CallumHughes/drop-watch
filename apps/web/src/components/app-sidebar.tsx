"use client";

import { APP_NAME } from "@drop-watch/brand";
import { Badge, Wordmark } from "@drop-watch/brand/components/logo";
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
            {/* The button's rounding changes instantly while its size animates,
                so it mustn't clip the badge: only the wordmark is clipped. The
                collapsed radius keeps the focus ring on the badge's corners. */}
            <SidebarMenuButton
              className="overflow-visible group-data-[collapsible=icon]:rounded-badge"
              render={<Link href="/" />}
              size="lg"
            >
              <Badge className="size-8 bg-sidebar-primary text-sidebar-primary-foreground" />
              {/* The menu button sizes every descendant svg to 16 square, which
                  letterboxes a 3.8:1 wordmark down to a smudge. Full height
                  instead: the row has width to spare, so the cap band is what
                  runs out first. */}
              <span className="flex min-w-0 overflow-hidden">
                <Wordmark className="h-8! w-auto!" />
              </span>
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
