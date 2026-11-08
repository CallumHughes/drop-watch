import { BADGE, MARK, WORDMARK_HORIZONTAL, WORDMARK_STACKED } from "../paths.generated";

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

/**
 * The mark in its rounded square, drawn to the favicon's geometry. Its corners
 * are the theme's `--brand-badge-radius`, which `brand:generate` bakes into the favicon. The caller
 * sets the size, the square's colour as a background and the mark's as text:
 * `<Badge className="size-8 bg-primary text-primary-foreground" />`.
 */
export function Badge({ className, style, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        borderRadius: `var(--brand-badge-radius, ${BADGE.radius})`,
        display: "inline-flex",
        flexShrink: 0,
        ...style,
      }}
      {...props}
    >
      {/* Inline size, so a parent's `[&_svg]` sizing can't shrink the mark. */}
      <svg
        aria-hidden="true"
        fill="currentColor"
        style={{ height: "100%", width: "100%" }}
        viewBox={BADGE.viewBox}
      >
        <g transform={BADGE.transform}>
          {MARK.paths.map((d) => (
            <path d={d} key={d} />
          ))}
        </g>
      </svg>
    </span>
  );
}
