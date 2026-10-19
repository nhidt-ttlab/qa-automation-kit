/// <reference types="@testing-library/jest-dom" />

// Brings the jest-dom matcher signatures (`toBeInTheDocument`, ...) into scope for `tsc`.
// The runtime side is registered in vitest.setup.ts; without this reference the matchers work
// under Vitest but fail the type-check, which is the sort of split that gets "fixed" by deleting
// the assertions.
export {};
