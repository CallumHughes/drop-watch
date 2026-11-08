import { APP_NAME } from "@drop-watch/brand";
import { WordmarkStacked } from "@drop-watch/brand/components/logo";
import Link from "next/link";

/**
 * The signed-out shell: no sidebar, just the page centered on a muted canvas.
 * Pages in this group bring their own `main` landmark, so this stays a div.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <Link aria-label={APP_NAME} href="/">
        <WordmarkStacked className="h-24 w-auto" />
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
