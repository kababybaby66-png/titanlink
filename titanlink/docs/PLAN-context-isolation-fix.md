# Context Isolation Security Fix - Implementation Plan

> **Priority**: P0 - CRITICAL SECURITY ISSUE  
> **Effort**: 16-24 hours  
> **Risk**: MEDIUM - Requires careful testing

---

## Problem Statement

**Current State**: `contextIsolation: false` in `electron/main.ts:433`

This is a **critical security vulnerability** because:
- Compromised renderer process can access Node.js APIs directly
- No security boundary between web content and system access
- Violates Electron security best practices

**Root Cause**: Native modules (UDP streaming) are currently loaded in the renderer process, which requires `nodeIntegration: true` and `contextIsolation: false`.

---

## Solution Architecture

### Phase 1: Move Native Module to Main Process ✅ (Already Done)

The UDP native module is already being used through IPC in production builds (see conversation `549baf82-d276-4532-a438-74a2d1c56226`).

**Current Architecture**:
- Development: UDP module loaded in renderer (causes the security issue)
- Production: UDP module loaded in main process via IPC

**Action**: Enforce production architecture in development too.

---

### Phase 2: Enable Context Isolation

**Changes Required**:

#### 1. Update `electron/main.ts` webPreferences

```typescript
webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    nodeIntegration: false,        // ✅ Disable Node.js in renderer
    contextIsolation: true,         // ✅ Enable context isolation
    sandbox: false,                 // Keep false only if native modules require it
}
```

#### 2. Update `electron/preload.ts` to use contextBridge

**Current** (INSECURE):
```typescript
// Direct global assignment - no isolation
window.electronAPI = { ... }
```

**New** (SECURE):
```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    system: {
        checkDrivers: () => ipcRenderer.invoke('system:check-drivers'),
        // ... all other APIs
    },
    // ... rest of API
});
```

#### 3. Update Type Definitions

**File**: `src/types/electron.d.ts` (create if doesn't exist)

```typescript
export interface ElectronAPI {
    system: {
        checkDrivers: () => Promise<DriverStatus>;
        installViGEmBus: () => Promise<InstallResult>;
        getDisplays: () => Promise<DisplayInfo[]>;
        getStats: () => Promise<SystemStats>;
    };
    // ... all other APIs with proper types
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
```

---

### Phase 3: Remove Direct Node.js Usage in Renderer

**Search for**:
- `require()` calls in `src/` directory
- Direct `fs`, `path`, `child_process` usage
- Any native module imports

**Action**: Move all to main process via IPC handlers.

---

### Phase 4: Testing Strategy

#### Manual Testing Checklist:
- [ ] App starts without errors
- [ ] Driver check works
- [ ] Display selection works
- [ ] Session creation works
- [ ] Controller input works
- [ ] Audio capture works
- [ ] Hardware capture works
- [ ] Settings page works
- [ ] Auto-updater works

#### Automated Tests:
- [ ] Add E2E test for session creation flow
- [ ] Add unit tests for IPC handlers
- [ ] Add security test to verify context isolation is enabled

---

## Implementation Steps

### Step 1: Audit Current Renderer Code (2 hours)

```bash
# Find all require() calls in renderer
grep -r "require(" src/

# Find all Node.js module usage
grep -r "import.*from 'fs'" src/
grep -r "import.*from 'path'" src/
grep -r "import.*from 'child_process'" src/
```

### Step 2: Create Secure Preload Script (4 hours)

1. Backup current `electron/preload.ts`
2. Rewrite using `contextBridge.exposeInMainWorld`
3. Ensure all IPC calls are properly typed
4. Test each API endpoint individually

### Step 3: Update Main Process (2 hours)

1. Enable `contextIsolation: true`
2. Disable `nodeIntegration`
3. Verify all IPC handlers are registered

### Step 4: Update Type Definitions (2 hours)

1. Create `src/types/electron.d.ts`
2. Define complete `ElectronAPI` interface
3. Remove `any` types from IPC calls
4. Update all renderer code to use typed API

### Step 5: Testing & Validation (6-8 hours)

1. Run manual testing checklist
2. Fix any issues found
3. Add automated tests
4. Verify in both dev and production builds

### Step 6: Documentation (2 hours)

1. Update ARCHITECTURE.md
2. Document security improvements
3. Add comments explaining the architecture

---

## Rollback Plan

If issues arise:

1. **Immediate**: Revert `electron/main.ts` changes
2. **Keep**: All type definitions and tests created
3. **Document**: What failed and why
4. **Plan**: Alternative approach

---

## Success Criteria

- [ ] `contextIsolation: true` in production
- [ ] `nodeIntegration: false` in production
- [ ] All features work as before
- [ ] No TypeScript errors
- [ ] No runtime errors
- [ ] Security audit passes

---

## Notes

- The UDP native module issue was already solved in production builds
- Main risk is finding hidden Node.js usage in renderer
- Type safety improvements are a bonus benefit
- This fix will make the app significantly more secure

---

**Next Action**: Run Step 1 (Audit) to identify all Node.js usage in renderer code.
