import { forwardRef, type TextareaHTMLAttributes } from 'react';

const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={['ui-textarea', className].filter(Boolean).join(' ')}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
