import styles from "./LoadingDots.module.css";

/** 3-dot loading indicator with staggered pulse. Announced as a live status. */
export function LoadingDots({ label = "Loading" }: { label?: string }) {
  return (
    <span className={styles.dots} role="status" aria-label={label}>
      <span className={styles.dot} style={{ animationDelay: "0s" }} aria-hidden="true" />
      <span className={styles.dot} style={{ animationDelay: "0.2s" }} aria-hidden="true" />
      <span className={styles.dot} style={{ animationDelay: "0.4s" }} aria-hidden="true" />
    </span>
  );
}
