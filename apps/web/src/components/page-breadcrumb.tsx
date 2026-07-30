"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@price-tracker/ui/components/breadcrumb";
import { usePathname } from "next/navigation";

const titles: Record<string, string> = {
  "/": "Dashboard",
  "/account": "Account",
  "/invites": "Invites",
  "/products/new": "Add product",
  "/settings": "Settings",
};

/** The inset-header label for the current page; pages keep their own h1. */
export function PageBreadcrumb() {
  const pathname = usePathname();
  const title = titles[pathname] ?? (pathname.startsWith("/products/") ? "Product" : "");

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbPage>{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
