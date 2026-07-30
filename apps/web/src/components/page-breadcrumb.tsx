"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@price-tracker/ui/components/breadcrumb";
import Link from "next/link";
import { usePathname } from "next/navigation";

const titles: Record<string, string> = {
  "/account": "Account",
  "/invites": "Invites",
  "/products/new": "Add product",
  "/settings": "Settings",
};

/** The inset-header breadcrumb trail; pages keep their own h1. */
export function PageBreadcrumb() {
  const pathname = usePathname();

  if (pathname === "/") {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Dashboard</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  const title = titles[pathname] ?? (pathname.startsWith("/products/") ? "Product" : "");

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link href="/" />}>Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{title}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
