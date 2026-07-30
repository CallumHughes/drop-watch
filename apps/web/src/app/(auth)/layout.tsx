/**
 * The signed-out shell: no sidebar, just the page centered on a muted canvas.
 * Pages in this group bring their own `main` landmark, so this stays a div.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
