import { Mark } from "@drop-watch/brand/components/logo";

export default function Loader() {
  return (
    <div className="flex h-full items-center justify-center pt-8">
      <Mark className="h-8 w-auto animate-pulse text-muted-foreground" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
