# Releasing (maintainers)

The download site lives in `docs/` (served by GitHub Pages from `main` / `/docs`). The app itself is not served there; people download the zip and open it locally.

```
python3 build.py          # builds docs/downloads/paycheck-planner-<version>.zip, SHA256SUMS and docs/index.html
python3 build.py --check  # confirms the page, SHA256SUMS and a fresh rebuild all agree
```

- The version comes from `VERSION` and must match `const VERSION` in `app.js` (the build fails otherwise).
- The zip is deterministic (sorted entries, fixed timestamps, stored uncompressed), so anyone can rebuild it from source and get the same SHA-256.
- To release a new version:
  1. Bump `VERSION` and `const VERSION` in `app.js`.
  2. Run `python3 build.py` and `python3 build.py --check`, then commit `docs/`.
  3. Merge to `main`.
  4. Create a GitHub release tagged `v<version>`, attach `docs/downloads/paycheck-planner-<version>.zip`, and use `releases/v<version>.md` as the release notes (copy the previous file and update the version and SHA-256).
- Older zips stay in `docs/downloads/` and remain listed in `SHA256SUMS`.
- The landing page template is `site/index.template.html`; the screenshot is `docs/assets/screenshot.png`. The download links in the template point at the file on `main` in this repository.
- Pages setup: repository **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/docs`**.
