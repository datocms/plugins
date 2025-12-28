/**
 * Utility for conditional class name concatenation.
 * Filters out falsy values and joins with spaces.
 *
 * @example
 * cn(styles.base, isActive && styles.active, isDisabled && styles.disabled)
 * // Returns: "base active" (if isActive is true, isDisabled is false)
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
