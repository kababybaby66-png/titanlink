# Task Plan: UI Redesign & Visibility Fixes

## Goal
Redesign the Host and Client overlays to look professional (replacing "cheap" logos and black screens) and fix "black on black" visibility issues for buttons across the application (Landing Page, Settings, etc.).

## Phase 1: Exploration & Analysis
- [x] **Host Overlay**: Locate the component rendering the host overlay. (`StreamView` + `ControllerOverlay`)
- [x] **Client Overlay**: Locate the component rendering the client overlay. (`StreamView`)
- [x] **Visibility Audit**: Identify specific buttons and areas with "black on black" contrast issues.
    - [x] Landing Page
    - [x] Settings Page
    - [x] Stream View / Other areas
- [x] **Style identification**: Determine current CSS/Tailwind classes causing the issues. (`CyberButton.css`, `index.css`)

## Phase 2: Design & Implementation - Overlays
- [x] **Host Overlay Redesign**: 
    - [x] Create a modern, translucent or glassmorphism background. (`StreamView.css`, `ControllerOverlay.css`)
    - [x] Replace/Style the logos/controls to look premium. (`ControllerOverlay.tsx`)
    - [x] Add "Broadcast Active" visual for Host. (`StreamView.tsx`)
- [x] **Client Overlay Redesign**:
    - [x] Apply similar premium styling to the Client Overlay. (`StreamView.css`)

## Phase 3: Design & Implementation - General UI Fixes
- [x] **Global Button Styles**: update primary/secondary button styles to ensure contrast. (`CyberButton.css`)
- [x] **Landing Page**: Fix specific button visibility. (Covered by Global fix)
- [x] **Settings Page**: Fix specific button visibility. (Covered by Global fix)
- [x] **Cleanup**: Ensure no "black on black" elements remain. (Brightened global metal colors and added outlines to all buttons).

## Phase 4: Verification
- [x] Review code changes.
- [x] Verify overlays look premium.
- [x] Verify all buttons are visible and accessible.
