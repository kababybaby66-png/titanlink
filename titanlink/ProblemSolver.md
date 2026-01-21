---
name: code-physician
description: Comprehensive workflow for identifying, planning, and executing non-destructive fixes for errors, warnings, and logical bugs. Use this skill when the user asks to "debug", "fix errors", "clean up warnings", or "resolve problems" in the codebase. It ensures existing functionality is preserved unless a replacement is explicitly part of the fix.
---

# Code Physician 🩺

This skill provides a structured, "medical" approach to codebase health. It prevents "shotgun debugging" by enforcing a diagnostic phase before any code is modified.

## Core Mandate
1. **Identify**: Use automated tools and manual inspection to locate the root cause.
2. **Plan**: Write a step-by-step fix strategy before editing.
3. **Execute**: Apply fixes iteratively.
4. **Preserve**: DO NOT remove existing functionality (the "before version") unless the fix explicitly requires upgrading a feature.
5. **Verify**: Re-run diagnostics to ensure the "patient" is cured and no new issues were introduced.

## Workflow Phases

### Phase 1: Diagnostics (The Checkup)
Before touching any code, generate a complete report of the current state:
- **Linting**: Run `npm run lint` (or equivalent) and save output.
- **Type Checking**: Run `npm run typecheck` or `tsc --noEmit`.
- **Log Collection**: Check application logs or terminal output for runtime errors.
- **Traceability**: Locate the exact file and line number for every reported issue.

### Phase 2: Triage & Planning
Create a "Fix Plan" in the conversation. For each issue identified:
1. **The Symptom**: What is the error/warning?
2. **The Cause**: Why is it happening? (e.g., missing prop, incorrect type casting, unused variable).
3. **The Cure**: What is the specific code change?
4. **Preservation Note**: Confirm that this change will not break existing logic.

### Phase 3: The Operation (Execution)
Execute the plan using `replace_file_content` or `multi_replace_file_content`.
- **Atomic Edits**: Fix one logical group of errors at a time.
- **No Deletions**: Avoid deleting blocks of code unless they are functionally redundant or the source of the error.
- **Safety First**: If a fix requires a breaking change to a function signature, ensure all callers are updated simultaneously.

### Phase 4: Verification (Post-Op)
Immediately after applying fixes:
1. Re-run Phase 1 (Lint/Typecheck).
2. Compare the new "medical report" with the old one.
3. If new errors appeared, revert or fix immediately.
4. If the user provided a reproduction case, verify it no longer fails.

## Guidelines for Specific Problems

### 1. TypeScript Errors
- **Always prefer proper types** over `any`.
- If a type is unknown from an external library, use `unknown` and type guards.
- Check `shared/types` first to see if a relevant interface already exists.

### 2. Linting Warnings
- **Unused Variables**: Check if they were intended for future use. If so, prefix with `_` instead of deleting.
- **Missing Hooks Dependencies**: Analyze if adding the dependency will cause infinite loops before adding it.

### 3. Logic Bugs
- If functionality must change, document the "Before" vs "After" behavior clearly for the user.

## Example Fix Plan Format

```markdown
### 🏥 Fix Plan: [Component Name]
1. **Issue**: `TS2322: Type 'string' is not assignable to type 'number'` in `App.tsx:45`.
   - **Fix**: Cast the input value using `Number()`.
   - **Preservation**: Ensures the calculation logic on line 50 remains valid.
2. **Issue**: Unused import `useState` in `Header.tsx`.
   - **Fix**: Remove the import.
```
