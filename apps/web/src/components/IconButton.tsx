import type { ButtonHTMLAttributes, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import './icon-button.css';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  /** Shows a small dot on the button, e.g. for unsaved changes. */
  dot?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ icon: Icon, label, dot = false, className = '', ...props }: IconButtonProps) {
  return (
    <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      <Icon size={18} aria-hidden="true" />
      {dot && <span className="icon-button-dot" aria-hidden="true" />}
    </button>
  );
}
