import { MARK, WORDMARK_HORIZONTAL, WORDMARK_STACKED } from "../paths.generated";

type LogoProps = React.ComponentProps<"svg">;

/**
 * Decorative by default: the mark and the wordmark are nearly always rendered
 * next to text that already names the product, and a second accessible name on
 * the artwork would read it twice. A caller using one on its own passes
 * `aria-hidden={false}` with a `role` and label of its own.
 */
function art(
  { paths, viewBox }: { paths: readonly string[]; viewBox: string },
  { children, ...props }: LogoProps
) {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      viewBox={viewBox}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
      {paths.map((d) => (
        <path d={d} key={d} />
      ))}
    </svg>
  );
}

/** The symbol alone — a falling arrow. Tall and narrow, at roughly 1:2.8. */
export function Mark(props: LogoProps) {
  return art(MARK, props);
}

/** "DropWATCH" on one line. */
export function Wordmark(props: LogoProps) {
  return art(WORDMARK_HORIZONTAL, props);
}

/** "Drop" above "WATCH", centred — for narrow or square spaces. */
export function WordmarkStacked(props: LogoProps) {
  return art(WORDMARK_STACKED, props);
}
