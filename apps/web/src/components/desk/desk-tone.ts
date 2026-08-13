/**
 * Shared semantic tone vocabulary for the D2 desk primitive layer.
 *
 * These map directly to the `tone-*` CSS modifier classes defined in
 * `desk-primitives.css`. The vocabulary intentionally mirrors the existing
 * {@link ProductTone} (`default | good | info | warn | bad`) so the desk layer
 * and the legacy `product-ui` components stay visually consistent.
 */
export type DeskTone = "default" | "good" | "info" | "warn" | "bad";

/**
 * Normalises a tone value into a CSS modifier class name (`tone-default`,
 * `tone-good`, ...). Centralising this keeps every primitive consistent.
 */
export function toneClass(tone: DeskTone | undefined): string {
  return `tone-${tone ?? "default"}`;
}
