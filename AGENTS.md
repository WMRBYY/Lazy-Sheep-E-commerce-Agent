# Repository instructions

This is the public meiyeai ecommerce edition. Keep changes inside its public scope.

- Read `docs/PUBLIC_SCOPE.md` before adding source, assets or dependencies.
- Preserve meiyeai and upstream copyright notices.
- Never import private modules, production data, credentials or old Git history.
- Feature flags and disabled routes are not a substitute for excluding private source.
- Keep model credentials on the server and out of browser bundles and logs.
- Verify builds and affected tests before pushing. Run release scope and secret checks.
- Do not claim real model quality based on mocked provider tests.
