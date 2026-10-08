/**
 * Diagnostics in the console, only in development builds (`npm start`, tests): the published
 * extension does not write to the console of the sites you visit. `__DEV__` is set by esbuild.
 */
export function log(...args: unknown[]): void {
  if (__DEV__) console.info('[video-upscaler]', ...args);
}
