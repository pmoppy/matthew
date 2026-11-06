# Test signing key

`shelfscan-test.p12` signs the APKs built by GitHub Actions so each new build
installs over the previous one (Android refuses updates signed with a different
key). It is committed on purpose and its password is public (`shelfscan-test`):
it is for **testing only**. Before publishing to the Play Store, create a
private upload key and store it in GitHub Actions secrets instead.
