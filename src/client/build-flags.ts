declare const __TEAMS_OPTIONAL_RUNTIME__: boolean | undefined;

// Optional providers are opt-in. The Teams core release build defines this as
// false, and an ordinary source/browser build must not render an API-backed
// CopilotKit runtime unless the build explicitly defines it as true.
export const optionalRuntimeEnabled = typeof __TEAMS_OPTIONAL_RUNTIME__ === 'undefined'
  ? false
  : __TEAMS_OPTIONAL_RUNTIME__;
