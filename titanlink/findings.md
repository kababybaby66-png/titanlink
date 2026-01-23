# Findings

## Research
*   (No findings yet)

## Important Files
*   `src/components/ControllerOverlay.tsx`: The "cheap" overlay component.
*   `src/pages/StreamView.tsx`: The main streaming view (Client Overlay).
*   `src/components/CyberButton.css`: Button styles causing visibility issues.
*   `src/index.css`: Global color variables.

## Design Notes
*   **Host/Client Overlay**: Currently `ControllerOverlay` uses basic text/divs. Needs a visual overhaul to match the "Cyber/Sci-Fi" theme.
*   **Visibility Issue**: `cyber-btn--secondary` used dark grey on black. Fixed by switching to semi-transparent backgrounds with borders.
*   **Missing Style**: `cyber-btn--ghost` was entirely missing from `CyberButton.css`, making buttons like "RESET_DEFAULTS" invisible (text-only with no container). Fixed by adding the variant.
*   **Goal**:
    *   **Overlay**: Glassmorphism, SVG/Icon-based controller visualization, clear telemetry.
    *   **Buttons**: Increase contrast, maybe use a lighter gray or a distinct border for secondary buttons.
