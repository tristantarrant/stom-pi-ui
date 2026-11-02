# Pulling features from `sejerpz/starless` into this branch

Reference for the occasional curation task: cherry-picking individual features out of
[`sejerpz/mod-ui`](git@github.com:sejerpz/mod-ui.git) branch **`starless`** (remote `sejerpz`)
into our integration branch, without pulling in work that we cannot run yet.

## Current policy (2026-11)

Only pull features that are **self-contained inside mod-ui**. Features that require changes to
the audio host (`stom-pi-modhost`, i.e. upstream `mod-host` — e.g. new socket commands or new
engine behaviour), or to the companion app (`stom-pi-hmi`, e.g. new device-protocol messages), are
**skipped for now** and logged in [Deferred](#deferred-list) until we decide to extend those sides.

## What `starless` is

- Integration/curation branch of sejerpz's **"alabs"** product line (custom MOD images). It merges
  upstream master regularly, so its history is a tangle of merges; as of the Oct-2026 fetch it was
  ~860 commits ahead of `mod/master`, based on the same merge-base this branch uses.
- Feature work often exists **three times**: in per-feature branches on the same remote
  (`sejerpz/feature/*`, `features/*`, `wip/*`), in `devel`, and merged into `starless`. The dedicated
  branch is usually the cleanest cherry-pick source. Some UI features also have a stefdoerr variant
  (remote `stefdoerr`) or were eventually sent upstream — check before picking from starless itself.
- Commit messages group related work by issue ref, e.g. `Closes sejerpz/alabs-mod-custom-images#71` —
  use that to find *all* commits belonging to one feature (fixes usually follow the initial commit).

## Which layer does a candidate touch?

| Layer | Files | Consequence for us |
|---|---|---|
| Host socket protocol | `mod/protocol.py` (`COMMANDS_USED` / `COMMANDS_ARGS`) | New or changed command ⇒ requires changes in **stom-pi-modhost** (C host). **Exclude.** As of the Oct-2026 fetch, starless had not modified this file vs master — re-check per feature. |
| Device protocol (hardware side) | `mod/mod_protocol.py`, `mod/hmi.py` | Commands between UI and MOD device; on Stom-Pi the companion app emulates the device over TCP (`MOD_HMI_TRANSPORT=tcp`). New command ⇒ needs **stom-pi-hmi** changes too. Mostly belongs to alabs' builder / on-device-editing flows — skip for now anyway (see below). |
| Pure UI/frontend | `html/**` (+ small backend hooks in `mod/*.py`) | Generally safe, provided the backend support it relies on is already in master or included in the same range. |
| C extension | `utils/*.{h,cpp}` → `libmod_utils.so` | Built from *this* tree by our packaging (self-contained), but must still compile against pinned deps and LV2 data — verify with `make -C utils`. Starless has grown it substantially (e.g. new lilv queries). |
| Licensing / alabs product code | `mod/licensing.py`, anything mentioning "alabs" | Proprietary to their product line. **Never cherry-pick.** If a feature is entangled with licensing, pick only the separable parts and note it in Deferred. |

Quick classification for a candidate range (a feature branch tip or two starless shas):

```bash
RANGE=sejerpz/feature/<name>          # or <old-sha>..<new-sha> on starless
git diff --stat mod/master...$RANGE   # what does it touch?
git diff mod/master...$RANGE -- mod/protocol.py        # non-empty ⇒ needs host work ⇒ defer
git diff mod/master...$RANGE -- mod/mod_protocol.py mod/hmi.py  # device protocol ⇒ check hmi side
```

## Workflow SOP

1. **Refresh refs**: `git fetch sejerpz stefdoerr mod`.
2. **Rebase onto latest upstream first** (standard branch-model rule): rebase this branch on
   `mod/master`, dropping anything now absorbed upstream. This shrinks both the starless diff and
   conflicts, and features already merged to master come along for free — no cherry-pick needed.
3. **Identify candidate features**:

   ```bash
   git log --oneline --no-merges mod/master..sejerpz/starless
   # group by issue ref / feature name; prefer the dedicated branch when it exists:
   git log --oneline sejerpz/feature/<name> ^mod/master
   ```

4. **Check for upstream absorption** before picking (by message, or `git cherry` against master): if
   master already has it, skip — our next rebase brings it in with correct attribution intact.
5. **Classify each feature** using the table above; defer host-dependent ones into Deferred below.
6. **Cherry-pick**, preserving original authorship and commit messages (AGPL: third-party commits
   must keep their authors; never squash or re-author). Use `-x` to record provenance in our history:

   ```bash
   git cherry-pick -x <sha> [<sha> ...]     # individual feature commits, oldest first
   ```

   Avoid picking merge commits (`-m 1`) — pick the linear feature commits instead. If a range is too
   entangled to separate cleanly, `git rebase --onto` of just that branch's unique commits can help;
   if it still doesn't resolve sanely, skip and log in Deferred (surmountable-conflict rule: resolve
   what you reasonably can manually).

7. **Conflicts**: our own local features live in `mod/webserver.py`, `mod/hmi.py` (TCP HMI transport),
   `mod/session.py`, `mod/settings.py`, plus the built-in file manager (`html/filebrowser.html`,
   `html/js/file_manager.js`) and `mod-ui.sh`. Starless touches many of the same files — resolve in
   favour of keeping Stom-Pi behaviour (TCP HMI transport, built-in user-files manager) intact and
   layer their feature on top.

   **CSS**: starless features often touch styles, so expect conflicts in `html/css/main.css` too.
   That file is a *generated* artifact (`less/*.less`, incl. bootstrap from local node_modules), not
   hand-edited source — never merge it by hand. Resolve the `.less` files instead, then regenerate:

   ```bash
   cd html/css && npm install && npx grunt less    # compiles less/main.less -> main.css (compressed)
   ```

   Caveat from earlier work on this branch (the quick-help styles): upstream ships `main.css` as a
   prebuilt single minified line, so our rebuild can differ from it in ways unrelated to the feature.
   After regenerating, verify expected sections still exist (T3K rules etc.); if the wholesale rebuild
   diverges too much, apply only the picked feature's CSS slice on top of the existing file instead —
   and keep `.less` sources and `main.css` consistent with each other either way.

8. **Verify before pushing**:

   ```bash
   make -C utils                                        # C extension builds against pinned deps
   source modui-env/bin/activate && pip install -e .    # or the venv you use for dev
   npm test                                             # frontend tests (Node built-in runner, test/js/)
   python3 -m unittest discover -s test -p 'test_*.py'  # Python-side tests
   ```

   Then smoke-run: start mod-host on its socket (5555) and the webserver against it; open every page
   touched by the picked features, exercise them, and check console/network for protocol errors.
9. **Push**: `git push --force-with-lease origin <branch>`.
10. **Bump the wrapper** (`../stom-pi/mod-ui` submodule pointer) as a deliberate commit with a
    changelog note recording which starless features were pulled in (and old→new upstream base if you
    rebased at step 2).

## Deferred list

Features skipped because they need work on stom-pi-modhost / stom-pi-hmi, or are entangled with
alabs licensing. Revisit when those sides can be extended. Format: `feature — reason (files/commands)`.

- alabs builder flow & on-device pedalboard editing (`wip/pb_hmi_edit`, `features/builder`) — device
  protocol commands such as `CMD_BUILDER_PLUGIN_LIST` (`'bpll'`) and licensing-dependent; needs the
  companion app side. *(recorded from Oct-2026 fetch)*
