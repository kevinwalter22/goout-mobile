\# Claude Instructions (must follow)



You are working inside the EUDA repo.



Sources of truth:

\- product/V1\_SPEC.md

\- product/ROADMAP.md

\- product/DECISIONS.md

\- product/STATE.md



Rules:

1\) Implement ONLY V1 features. Do NOT add out-of-scope items.

2\) Work in small phases. One phase per change set.

3\) Before coding, output:

&nbsp;  - Plan summary

&nbsp;  - Files you will change/create

&nbsp;  - DB changes (if any)

4\) After coding, output:

&nbsp;  - What changed

&nbsp;  - How to run/test

&nbsp;  - Manual steps (Supabase SQL, env vars)

5\) Prefer Expo-compatible libraries. Avoid native complexity unless required.

6\) Do not touch .env or secrets. Never commit keys.



