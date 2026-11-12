# AMSA ticket data check (12 November 2026)

Every near coastal certificate page on amsa.gov.au was compared with the app's ticket data (`TICKETS`, `REQS`, `COVERS` in `app/index.html`).

## Corrected
- **Master (Inland Waters):** days were 30 / 150, now **60 / 120**; vessels at least **7.5m**; course confirmed (Certificate III, Master Inland Waters NC); AMPA added; first aid confirmed; "unconfirmed" flags removed.
- **Coxswain Grade 2:** AMSA places no duty restriction on this ticket (commercial or recreational vessels), so the deck-only filter was removed.
- **Coxswain Grade 1:** the AMPA is a plain RTO assessment; the "vessel over 5m" wording belonged to the sea service requirement, not the assessment.
- **Master <45m:** removed an AMPA line that applies to renewals, not new certificates; course named (Certificate IV, Master up to 45 metres); Mate <80m (phased out 1 Jan 2023) added as an alternative prerequisite; the role ambiguity (watch-in-charge versus master days) is flagged for AMSA.
- **Master <100m:** course named (Diploma of Maritime Operations); note now describes both pathways (360/720 days with 120/240 on watch for Mate <80m or other non-command certificates); the old 120-day PDF caveat removed because AMSA's page gives 240 in both tables.
- **MED 3:** Coxswain 3 days do not count (AMSA says Coxswain grade 2 or 1); unverified AMPA sentence removed.
- **MED 2:** General Purpose Hand days no longer count (AMSA lists only an engineer or assisting an engineer); "diesel" removed (AMSA says inboard engines).
- **MED 1 and Engineer Class 3:** "diesel" removed; prerequisite wording tightened; Engineer Watchkeeper path is 90 days; Engineer Class 3 course is the Diploma of Marine Engineering only.
- **GPH:** the eyesight wording now follows AMSA's GPH page (restricted from night lookout duties unless supervised).
- **Medical renewals:** MED 1 and Engineer Class 3 renewals need a new 1850, like Master <45m and <100m.
- **Covers:** Coxswain 2 covers Coxswain 3 only (as AMSA states); Master Inland Waters and the Sailing Master certificates cover GPH.

## Added
- **Sailing Master Coastal NC** and **Sailing Master Offshore NC**: qualification-only certificates (no sea service days). They show a requirements checklist and are usable in the Application pack.

## Not verifiable from AMSA's pages
- The exact eyesight numbers (6/6, 6/9, N8, Ishihara) in the deck eyesight note. AMSA's certificate pages link to a separate medical requirements page.
- Master <45m and <100m: whether the non-watch days must also be watch-in-charge days.
- Ferry-in-chains endorsements, the Coxswain 3 marina-only path and the MED 3 "half on inboard diesel" rule are described in notes but not tracked.
