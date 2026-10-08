declare module '*.glsl' {
  const source: string;
  export default source;
}

/** true in development and test builds, false in the published package (see scripts/build.mjs). */
declare const __DEV__: boolean;
