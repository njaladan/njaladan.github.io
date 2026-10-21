# Repository workflow

- Use only this GitHub repository for the website. Do not create or update separate Sites-hosted copies, including Ganesh Field Notes.
- Always run `git pull origin master` before starting work. Preserve any existing local changes while pulling and resolve merge conflicts before continuing.
- When the requested work is complete, run the checks appropriate to the changes, commit the completed work, and push it to `master` with `git push origin HEAD:master`.
- If the push is rejected because `master` advanced, pull the latest changes, reconcile them, rerun affected checks, and retry the push. Do not force-push.
