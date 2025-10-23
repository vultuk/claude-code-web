Analyze all changes since the last published version. 
Determine the appropriate new version number using semantic versioning rules:
- MAJOR for incompatible changes,
- MINOR for backwards-compatible new features,
- PATCH for backwards-compatible bug fixes.

Once ready:
- Update the project’s version number in all relevant files. 
- Update the @CHANGELOG.md file with the new changes
- Create an appropriately names branch
- Add all modified files to the commit (git add -A).
- Create a commit with a clear message describing the version bump, following conventional commit format (e.g., "chore(release): vX.Y.Z").
- Tag the commit with the new version number.
- Push both the commit and the tag to GitHub.
- Create a release from the new tag.
- Create a PR to main from this new branch
- Use the gh command to force merge the PR
- Finally, if the project requires publishing to NPM you can publish the updated project.