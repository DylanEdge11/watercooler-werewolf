# Documentation review — September 20, 2026

## Verdict

The previous README contained useful rules but was unsuitable as a first-time moderator handoff: it mixed play, deployment, tests, security implementation, and historical release notes. No dedicated “How to Use Watercooler Werewolf” guide existed.

The revised README is a short starting point. The new [user guide](HOW_TO_USE_WATERCOOLER_WEREWOLF.md) gives players and moderators one ordered workflow, supported by actual fictional-game screenshots. It has been checked against source and recorded hosted evidence; an independent first-time human usability trial remains unperformed.

## Scope

Documentation changes only. Application files were read to verify labels, rules, prerequisites, and recovery consequences; application code, databases, games, invitations, and deployments were not changed.

Primary instructional review: README, VERCEL_SETUP_GUIDE, OPERATIONS, PILOT_TESTING, TECHNICAL, fixture README, and the local/hosted Playwright runbooks. BUILD_STATUS, migration/implementation records, prior reviews, hosted QA reports, and full-game test handoffs were consulted as dated evidence. Historical test prompts and findings are retained rather than rewritten as current user instructions.

## Findings addressed

| Finding | Effect on a new reader | Change |
| --- | --- | --- |
| README mixed audiences and repeated long references | No clear starting point | Short introduction, audience-based guide table, one user guide |
| No end-to-end beginner workflow | Moderator needed outside explanations | Numbered setup and phase sequence, exact buttons, expected outcomes |
| Pilot guide used obsolete ChatGPT owner sign-in | Fresh setup could not be followed | Explicit migration and operator bootstrap before startup |
| Technical/operations references still described D1, Workers, and request-time migrations | Wrong maintenance and persistence model | Current Next.js/Vercel/libSQL reference and explicit migrations |
| Scheduler reference used an obsolete secret and implied unattended operation | Moderator might wait for phases/results that never appear | CRON_SECRET, optional sweep, manual open/review/publication made explicit |
| Setup guide said no deployment existed; old BUILD_STATUS looked current | Readers could confuse historical state with current hosting | Reframed operator setup and added prominent historical-log notice |
| Invite code versus PIN and one-time export were unclear | Players could lose access or receive the entire roster export | Explicit join/return flow and individual delivery instructions |
| Recovery could be mistaken for pause/resume or full game restoration | Moderator could erase a game unintentionally | Stop has no Resume; Reset and restore restart setup with fresh access |
| Roles and edge cases scattered across files | Inconsistent moderation | All six roles, slot scaling, ties, no-vote, Hunter, protection, final ballots, and victory in one guide |
| Recorded completed-game UI still says awaiting moderator | Moderator could wait unnecessarily | Explain COMPLETED and official timeline winner as authoritative |
| Fictional fixture could be imported twice | Existing invitations would be replaced | Clarify that pilot:setup already imports it |

## Coverage against the request

| Required capability | Guide coverage / verification basis |
| --- | --- |
| First-time player access | Claim, six-digit PIN, returning seat-code sign-in, lost access; claim/login components and roster export |
| All player roles | Six-role table and six actual role screenshots; catalog, action permissions, engine |
| Normal player participation | Select/save/revise, deadline, timeline, private results, rooms, elimination, feedback; player page |
| First-time moderator setup | Account prerequisite, schedule/timezone, CSV, claim meter, composition, randomize/release; moderator page and setup routes |
| Full moderator game loop | Open, collect, lock/calculate, review, Hunter, publish, repeat; live panel and phase route |
| Rule exceptions and finish | Slot limits, missing votes, ties, protection, overrides, final cutoff/ballots, both win conditions; engine and phase policy |
| Operational controls | Notices, co-moderators, PIN/password recovery, rooms, backup, Stop, Reset, restore, cancel/new setup; operations UI/routes |
| Concise, usable navigation | Task-based sections, short numbered procedures, comparison tables, quick reminder, troubleshooting |
| Relevant screenshots | Two embedded workflow examples, links to six role screens and completion; fictional data only |

## Hosted evidence and limitations

The September 19 [hosted QA report](PLAYWRIGHT_HOSTED_QA_REPORT.md) identifies Preview `dpl_BU6dMkHvU1cUFou477j2bBX184hC` at `https://watercooler-werewolf-21kmzkv1j-dyl-edge.vercel.app`. The September 20 UTC run `qa80-20260920015903016` used that Preview and recorded a complete 80-player Village victory. Its local report says gameplay passed but overall QA failed for the contradictory completed-screen text; this review does not relabel it as a full pass.

Screenshots were copied unchanged from that run's `outputs` folder into `docs/images/how-to-use`, so the guide does not depend on ignored output files. All nine included images were visually inspected. They show fictional names, role views, published outcomes, and no PINs, claim URLs/codes, passwords, cookies, or recovery codes. Role screenshots show the between-phase state; the moderator screenshot shows a published result, not an unpublished approval screen. Captions and instructions distinguish these states.

Fresh public requests could not reach the deployment from this review environment. The connected Vercel API returned HTTP 403 for the team's deployment scope, and the local CLI fallback could not fetch deployment details. Consequently, the guide describes the recorded Preview/current-source behavior, and does not assert live Production parity or a new authenticated full-game walkthrough. No production game was altered to obtain screenshots.

## Documentation verification

- Checked 55 relative document/image links in the nine reviewed/created Markdown files: no missing targets.
- Opened the HTML reading copy in Chromium at 1280×1000 and 390×844: no horizontal overflow, broken embedded workflow images, or JavaScript page errors.
- Checked all seven in-page navigation targets and opened/closed an embedded role screenshot: passed.
- Visually reviewed the desktop/mobile rendering and all nine source screenshots.
- Checked exact action labels and consequential rules against the relevant UI and server routes, including owner-only co-moderator creation and Hunter finalization.
- Application tests were not rerun: this change only edits documentation and adds documentation assets. No new gameplay validation is claimed.

The HTML copy is generated from the Markdown guide and embeds its screenshots. Update both copies together; keep the Markdown as the editable source. Supporting Markdown links in the HTML require the companion repository documents.

## Maintenance

Keep user-facing behavior in the user guide, operational recovery consequences in OPERATIONS, and implementation detail in TECHNICAL. When UI labels, rules, auth, or lifecycle behavior change, update the related guide steps and screenshots together. Keep test reports dated and distinguish Preview evidence from Production release approval.
