declare const __TEAMS_OPTIONAL_RUNTIME__: boolean | undefined;

// Normal browser builds keep the optional assistant enabled. The Teams core
// release build defines this as false so deterministic slices do not bundle
// or render an API-backed CopilotKit runtime.
export const optionalRuntimeEnabled = typeof __TEAMS_OPTIONAL_RUNTIME__ === 'undefined'
  ? true
  : __TEAMS_OPTIONAL_RUNTIME__;
