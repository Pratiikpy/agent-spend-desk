# Bright Data: Integration Notes

**Status: required ONLY for Wildcard [Bounty]. Optional otherwise. Facts about the product: NOT VERIFIED.** Bounty prize amount: not published, to be presented at onboarding on 21 Oct 2026.

Organizer framing: "Bright Data: scraping external data" (Data Day, 12 Oct 2026, 22:00 UTC, recorded). Context: `docs/intel/03-sponsor-by-sponsor-expectations.md`.

## Applies to us only if

- [ ] We choose Wildcard [Bounty], or
- [ ] Web data genuinely improves a track entry (then it is a bonus, not a requirement).

## Verified facts

| Fact | Value | Source | Date verified |
|---|---|---|---|
| What Bright Data offers for this hackathon | | | |
| Access, credits, pricing | | | |
| Auth model and credential name(s) | | | |
| Rate limits | | | |
| Terms of service constraints for the sites we target | | | |
| Failure modes observed | | | |

## Bounty requirements (from the FAQ)

- Bring an existing project, prototype or concept.
- **Meaningfully integrate Bright Data** and **demonstrate how it is used to collect or scrape relevant web data.**
- Record the project's state before 22 Oct 00:00 UTC and declare it as pre-existing.
- Target a small set of relevant sites; show how collected data changes the agent's decision, insight or action; cache a sample so the demo works if live collection fails.
- Sponsor explanation must also cover how Bright Data collected or scraped the data.

## Scraping hygiene

Respect each target site's terms and robots rules; collect only public data; no personal data; store samples under `data/sample/` with source URL, collection date and licence note in `data/README.md`.
