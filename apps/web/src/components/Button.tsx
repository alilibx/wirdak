import type { ButtonHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

type Variant = "primary" | "ghost" | "whatsapp" | "gold";

const base =
  "flex w-full items-center justify-center gap-2.5 rounded-ui px-5 py-3 font-sans transition duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary:
    "min-h-[62px] bg-green text-[#fbf6ea] text-[1.15rem] font-semibold shadow-[0_6px_0_var(--green-deep),0_10px_24px_rgba(19,58,45,0.25)] active:translate-y-1 active:shadow-[0_2px_0_var(--green-deep)]",
  gold: "min-h-14 bg-gold text-[#2b1f05] text-[1.15rem] font-semibold shadow-[0_6px_0_#a57a1e]",
  whatsapp:
    "min-h-14 bg-wa text-white text-[1.15rem] font-semibold shadow-[0_5px_0_#0f5e34]",
  ghost:
    "min-h-14 border-2 border-line bg-transparent text-ink-soft text-base font-medium",
};

/**
 * The button look, for links that must read as buttons. `extra` wins over the variant's own
 * classes: a plain join would leave the winner to the stylesheet's order, which put a ghost
 * button's grey over the red of a delete button.
 */
export function buttonClass(variant: Variant = "primary", extra = ""): string {
  return twMerge(base, variants[variant], extra);
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant };

export function Button({
  variant = "primary",
  type = "button",
  className = "",
  ...rest
}: Props) {
  return (
    <button type={type} className={buttonClass(variant, className)} {...rest} />
  );
}
