import { Mark } from "@drop-watch/brand/components/logo";

export default function Loader() {
  return (
    <div aria-live="polite" className="flex h-full items-center justify-center pt-8" role="status">
      <Mark className="h-8 w-auto text-muted-foreground motion-safe:animate-pulse" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
