import { auth } from "@price-tracker/auth";
import { Separator } from "@price-tracker/ui/components/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@price-tracker/ui/components/sidebar";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { ModeToggle } from "@/components/mode-toggle";
import { PageBreadcrumb } from "@/components/page-breadcrumb";

/**
 * The signed-in shell: collapsible sidebar plus a slim inset header.
 *
 * The session check here is UX, not security — layouts do not re-run on client
 * navigation, so every page in this group keeps its own `getSession` guard as
 * the actual boundary. This one only spares a signed-out visitor a flash of
 * chrome before the page-level redirect fires.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <SidebarProvider>
      {/* The user rides down as plain props rather than through
          authClient.useSession() in the sidebar: the client hook resolves
          after SSR, and the admin-gated Invites item appearing only on the
          client is a hydration mismatch that torpedoes the whole tree. */}
      <AppSidebar
        user={{
          email: session.user.email,
          image: session.user.image ?? null,
          isAdmin: session.user.role === "admin",
          name: session.user.name,
        }}
      />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <SidebarTrigger className="-ml-1" />
          <Separator
            className="mr-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
            orientation="vertical"
          />
          <PageBreadcrumb />
          <div className="ml-auto">
            <ModeToggle />
          </div>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
