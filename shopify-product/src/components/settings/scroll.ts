/**
 * `'smooth'`, unless the user asked for reduced motion. A script-requested
 * smooth scroll ignores CSS `scroll-behavior` guards, so every
 * `scrollIntoView` here goes through this.
 */
export function scrollBehavior(): ScrollBehavior {
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduced ? 'auto' : 'smooth';
}
