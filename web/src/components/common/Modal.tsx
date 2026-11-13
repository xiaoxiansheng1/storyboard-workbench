import { type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from './Button';
import styles from './Modal.module.css';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const HEADER_ICON = 14;

export function Modal({
  title,
  onClose,
  children,
  footer,
  size = 'md',
  className,
  closeDisabled,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  className?: string;
  closeDisabled?: boolean;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next && !closeDisabled) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} data-modal-overlay />
        <Dialog.Content
          className={[styles.content, styles[size], className ?? ''].filter(Boolean).join(' ')}
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            if (closeDisabled) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (closeDisabled) event.preventDefault();
          }}
        >
          <header className={styles.head}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <Dialog.Close asChild disabled={closeDisabled}>
              <Button variant="icon" className={styles.closeBtn} type="button" title="关闭">
                <X size={HEADER_ICON} />
              </Button>
            </Dialog.Close>
          </header>
          <div className={styles.body} data-modal-body>
            {children}
          </div>
          {footer ? (
            <footer className={styles.actions} data-modal-actions>
              {footer}
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
