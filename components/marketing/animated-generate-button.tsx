import Link from "next/link";
import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./animated-generate-button.module.css";

type AnimatedGenerateButtonProps = {
  label: string;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  className?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  title?: string;
};

export function AnimatedGenerateButton({
  label,
  href,
  onClick,
  leadingIcon,
  trailingIcon,
  className,
  fullWidth = false,
  disabled = false,
  title,
}: AnimatedGenerateButtonProps) {
  const content = (
    <span className={styles.content} aria-hidden="true">
      <span className={styles.icon}>{leadingIcon ?? <Sparkles strokeWidth={2} />}</span>
      <span className={styles.label}>
        {Array.from(label).map((character, index) => (
          <span
            key={`${character}-${index}`}
            className={styles.letter}
            style={{ "--letter-index": index % 13 } as CSSProperties}
          >
            {character === " " ? "\u00a0" : character}
          </span>
        ))}
      </span>
      {trailingIcon && <span className={styles.icon}>{trailingIcon}</span>}
    </span>
  );

  const outerClassName = cn(styles.frame, fullWidth && styles.fullWidth);
  const buttonClassName = cn(styles.button, fullWidth && "w-full", className);

  return (
    <span className={outerClassName}>
      {href ? (
        <Link href={href} aria-label={label} className={buttonClassName} title={title}>
          {content}
        </Link>
      ) : (
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          title={title}
          className={buttonClassName}
        >
          {content}
        </button>
      )}
    </span>
  );
}
