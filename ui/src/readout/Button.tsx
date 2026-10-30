import type { ButtonHTMLAttributes } from "react";

/**
 * A button. `primary` marks the one main action of a view; `critical` confirms an
 * irreversible action, inside a confirmation step only, with a label naming what is lost.
 */
export function Button({
  variant = "standard",
  large = false,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "standard" | "primary" | "critical";
  large?: boolean;
}) {
  const classes = ["ro-button"];
  if (variant !== "standard") classes.push(`ro-button--${variant}`);
  if (large) classes.push("ro-button--large");
  if (className) classes.push(className);
  return <button type={type} className={classes.join(" ")} {...props} />;
}
