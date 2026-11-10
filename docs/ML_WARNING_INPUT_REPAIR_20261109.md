# ML warning inputs and display repair — 9 November 2026

The two screenshot messages have separate causes. The live Taehwa rainfall window is complete; the warning classifier genuinely failed its saved independent accuracy checks. This repair addresses the live-input timing/refresh fault and clarifies those separate states. It does not claim that the warning model has been scientifically repaired.

## Implemented

- Read back official rainfall after a completed recovery before returning feature quality. Previously recovery was started in the background after the first read, allowing an incomplete result to be returned and cached even while observations were being added.
- Bound the recovery wait to 2.5 seconds. Slow repairs remain explicitly pending; missing observations remain missing.
- Expire incomplete-rainfall station responses after five seconds instead of a full minute, and invalidate cached detail when recovery completes.
- Make the existing Refresh button request a fresh station response through both frontend and backend caches.
- Report exact observed-hour coverage and missing timestamps for the required 24-hour rainfall window.
- Separate “Current station inputs: Ready” from “Unavailable — validation failed” in the existing warning panel, with a plain explanation. The network failure banner and independent-test metrics remain visible.

No model acceptance thresholds were lowered. No warning probabilities were invented, and no model was promoted. Existing river-level forecasts and UI architecture were retained.

## Live verification

Verified the actual running backend on configured port 5001 and the ML Analysis page on localhost:5173 after pressing Refresh. Taehwa showed:

- Inputs FRESH / Ready.
- 24/24 observed rainfall hours, ending 2026-11-09 02:00 KST; zero missing hours.
- All three level forecast horizons AVAILABLE.
- Warning validation INDEPENDENT_TEST_ACCEPTANCE_FAILED and probability null.

Saved the API response evidence in `backend/reports/live-warning-repair/verification.json`. The saved warning model has approximately 1.876% test precision against the required 20%; repairing current rainfall does not change that historical independent result. Enabling a warning probability still requires a model that passes a genuinely untouched evaluation.

## Verification

- Backend: 368 tests passed, zero failed.
- Frontend: 43 package tests and seven additional JavaScript tests passed (50 total).
- Changed frontend files passed ESLint.
- Frontend production build passed; Vite retained its existing large-chunk advisory for the map bundle.
- Browser check confirmed the refreshed page displays Ready and 24/24 hours alongside the honest failed-validation status.

Regression cases cover completed recovery, unavailable records, genuine zero rainfall, slow pending recovery, exclusion of future observations, and withholding a failed model's probability even with fresh inputs.
