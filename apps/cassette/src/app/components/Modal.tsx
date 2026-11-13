"use client";

/**
 * Modal — the WRAP-AND-RESKIN PATTERN ([[ActionButton]]) applied to a dialog: a
 * thin Cassette wrapper over React Aria's `ModalOverlay` + `Modal` + `Dialog`,
 * reskinned by a co-located `.module.css` that targets the primitives' `data-*`
 * states ([data-entering], [data-exiting]) and maps each onto design tokens.
 *
 * React Aria supplies everything that made the hand-rolled ConfirmDialog fragile
 * to maintain: focus trap, return-focus to the trigger, `Escape` to close,
 * backdrop dismiss (`isDismissable`), and `aria-modal` wiring. We own only the
 * look. Compose it with `DialogTrigger` (re-exported here so call sites import
 * the dialog vocabulary from one place rather than raw react-aria-components):
 *
 *   <DialogTrigger>
 *     <ActionButton>Open</ActionButton>
 *     <Modal title="…">{({ close }) => <form>…</form>}</Modal>
 *   </DialogTrigger>
 *
 * `children` may be a render function receiving `{ close }` (RA's Dialog render
 * prop) so the body can dismiss itself after submit.
 */

import {
  ModalOverlay,
  Modal as RAModal,
  Dialog,
  DialogTrigger,
  Heading,
  Button,
} from "react-aria-components";
import type { ModalOverlayProps, DialogRenderProps } from "react-aria-components";
import styles from "./Modal.module.css";

export { DialogTrigger };

type ModalProps = Omit<ModalOverlayProps, "children"> & {
  title: string;
  subtitle?: string;
  /** Panel width: "md" (default, a confirm/form) or "lg" (a working pane with
   *  rows, e.g. Pair a device). */
  size?: "md" | "lg";
  children: React.ReactNode | ((opts: DialogRenderProps) => React.ReactNode);
};

export function Modal({ title, subtitle, size = "md", children, ...props }: ModalProps) {
  return (
    <ModalOverlay {...props} isDismissable className={styles.overlay} data-html2canvas-ignore="true">
      <RAModal className={size === "lg" ? `${styles.modal} ${styles.modalLg}` : styles.modal}>
        <Dialog className={styles.dialog}>
          {(renderProps) => (
            <>
              <span aria-hidden="true" className={styles.stripe} />
              <div className={styles.head}>
                <div className={styles.heads}>
                  <Heading slot="title" className={styles.title}>
                    {title}
                  </Heading>
                  {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
                </div>
                <Button
                  className={styles.close}
                  onPress={renderProps.close}
                  aria-label="Close"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </Button>
              </div>
              <div className={styles.body}>
                {typeof children === "function" ? children(renderProps) : children}
              </div>
            </>
          )}
        </Dialog>
      </RAModal>
    </ModalOverlay>
  );
}
