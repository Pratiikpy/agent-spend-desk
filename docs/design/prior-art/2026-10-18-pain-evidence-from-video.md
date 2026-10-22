# Pain evidence for the prior-authorization pack, from public videos

Date: 2026-10-18. Method: YouTube search (yt-dlp), auto-captions of six videos read in full or in part. Transcripts live in `research/pain/` (gitignored). These are secondary explainers and journalism, not primary data: every number below is **NOT VERIFIED** until checked against its primary source (KFF analyses of Medicare Advantage, CMS rules, AMA surveys).

| Claim | Source video | Verify against |
|---|---|---|
| About 8% of prior authorizations are denied across carriers; only about 11.5% of denials are appealed; about 80% of appealed denials are overturned (reported by the presenter as 80.7%) | "Prior Authorization Statistics" (AHealthcareZ, `tqdtw-VjPeE`) | KFF Medicare Advantage prior-authorization analysis |
| Prior authorization is a poor test of clinical appropriateness because most appealed denials are overturned | same | same |
| One in three doctors report a serious medical event or death of a patient linked to prior authorization (as stated in the film) | "Denying Your Health Care Is Big Business in America" (NYT Opinion, `9s3CN5EafNs`) | AMA physician survey |
| A prescriber says about 95% of the time a prior authorization is needed; peer-to-peer calls with reviewers who may not be physicians, up to 5 to 10 a day | same | the interviews are anecdotes: do not cite as rates |
| A utilization-review nurse can work about 18 cases a day, with 24 hours to 14 days to decide, going back and forth with doctors' offices to complete the file | "What Utilization Review Nurses Actually Do" (`mrw_YGuIVT4`) | a practitioner call; one nurse's account |
| Day counts and guidelines come from two commercial vendors (MCG and InterQual); MCG says it touches 208 million lives | AHealthcareZ (`pIM35-zspl4`, `4KOGZg2s8cI`) | MCG and Optum documents |
| Weekends and holidays create a notification backlog, so admissions slip past approval windows | `pIM35-zspl4` | a practitioner call |

## What this means for the product (design implications, not results)

- The pain is not "slow"; it is wrong holds that cost days, then silence: most denials are never appealed, and most appeals that happen succeed. A system that routes weak holds to a clinician with the exact criterion and the one flip fact attacks the wrongly-held case directly, and it never denies.
- The reviewer's real work is completing a disagreeing file against a published criterion within a clock. This is the Reconcile, Explain and Decide chain in one screen.
- Appeal replay (F-S16) matters: the same case, run against the policy version in force at the time, is exactly what the appeal needs.
- Open question: whether the commercial guideline text (MCG, InterQual) can be used at all. It is licensed; our criteria stay our own versioned rules from public coverage text.

## Next evidence to collect

Five practitioner conversations (utilization-review staff, a prior-auth coordinator at a practice, a payer medical director) and the primary KFF and CMS sources for every number above.
