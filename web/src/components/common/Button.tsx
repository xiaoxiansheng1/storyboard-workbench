import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import styles from './Button.module.css';

type ButtonVariant = 'default' | 'primary' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
  big?: boolean;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', block, big, asChild, className, ...props },
  ref,
) {
  const classes = [
    styles.button,
    variant === 'default' ? '' : styles[variant],
    block ? styles.block : '',
    big ? styles.big : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={classes} {...props} />;
});
