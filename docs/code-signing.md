# Code signing (SignPath Foundation)

wispy is unsigned today, so Windows SmartScreen says "unrecognised app" on first run. SignPath Foundation signs open-source projects for free. The release workflow is already wired for it and stays unsigned until you add the settings below.

## One-time setup (you do these, they need your identity)

1. Apply at <https://signpath.org/apply> for the repo `chengxii-lii/wispy` (MIT licence, public, free downloads). Wait for approval.
2. In SignPath, create a project (note its **slug**) and add the artifact configuration from [`.signpath/artifact-configuration.xml`](../.signpath/artifact-configuration.xml).
3. Link the project to this GitHub repo as its trusted build system (SignPath's GitHub integration), and note the **signing policy slug** (usually `release-signing`).
4. Create a SignPath API token for a CI user.
5. In GitHub, repo **Settings, Secrets and variables, Actions**:
   - Secret `SIGNPATH_API_TOKEN`
   - Variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG`
6. Push a tag as usual. SignPath asks you to approve each signing request. The workflow then signs `wispy.exe` and `wispy-helper.exe`, checks the signatures are valid, and builds the zip.

## After the first signed release

- Remove the "not code-signed yet" notes: README (Install, Known limits, Code signing policy), `scripts/make-zip.ps1` (README.txt), and the launch page `site/index.html` (install note).
- SmartScreen still builds reputation from downloads, so the first weeks may show a softer warning. Signing makes it fade; it doesn't flip off at once.
- If Defender flags a build, submit the file at <https://www.microsoft.com/en-us/wdsi/filesubmission> as a false positive.

The workflow's signing steps are tested only once the settings exist; if SignPath changes its action's inputs, fix them in `.github/workflows/release.yml`.
