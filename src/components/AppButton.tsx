import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

export type AppButtonVariant = "default" | "primary" | "danger" | "ghost";
export type AppButtonSize = "sm" | "md";

interface AppButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  block?: boolean;
}

function joinClasses(parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" ");
}

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(function AppButton(
  {
    variant = "default",
    size = "sm",
    block = false,
    className,
    type = "button",
    ...rest
  },
  ref
): JSX.Element {
  return (
    <button
      ref={ref}
      type={type}
      className={joinClasses([
        "app-button",
        `is-${variant}`,
        `is-${size}`,
        block ? "is-block" : null,
        className
      ])}
      {...rest}
    />
  );
});
