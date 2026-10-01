# GrowUp SEO & AEO delivery tracker

Static site + Supabase. No build step.

## Setup
1. Supabase > SQL Editor: paste and run `schema.sql`.
2. Supabase > Authentication > Users: add a user (email + password) for each teammate.
3. Put your project URL and anon key in `config.js`.
4. Run locally: `python -m http.server 8000` then open http://localhost:8000
5. Sign in, click **New client**. The 90-day plan is created from the template in `schema.sql`.

## Deploy
Push this folder to a GitHub repo, then Settings > Pages > deploy from `main`.

## Brand colours
Change the variables at the top of the `<style>` block in `index.html`. Drop `growuplogo.png` in this folder to show your logo.
