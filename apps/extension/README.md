# Social Listening Chrome Extension

Chrome Manifest V3 data-collection agent for the Facebook scope of
`listening_socialmediav2`.

## Commands

```bash
npm install
npm run check
```

Load the generated `dist/` directory from `chrome://extensions` in developer mode.

The popup defaults to `http://localhost:4000/api/v1`, matching Docker Compose.
The manifest allows only localhost and the deployed Social Listening web origin. Keep
the requested host permissions as narrow as possible when the deployment origin
changes.

## Safety boundaries

- The extension only reads the Facebook DOM visible to the signed-in browser
  profile.
- It does not receive or upload Facebook cookies, credentials, profile URLs,
  usernames/handles, or platform user IDs.
- It does not solve or bypass login, CAPTCHA, 2FA, checkpoint, or challenge pages.
- It never posts, comments, reacts, follows, or sends messages.
- Facebook search is opened through a read-only URL; the content script never
  types into a Facebook input, editable composer, or form.
- The single DOM click site is guarded by an exact read-control allowlist. It
  accepts only expand/load/filter controls such as `See more`, `Most relevant`,
  `All comments`, `View more comments`, and anchored `View N more replies`
  variants; submit, post, comment, reply, like, reaction, share, and send
  controls are rejected.
- The content script never calls `form.submit()`, `requestSubmit()`, Facebook
  `fetch()`, or any private Facebook endpoint.
- Only the tab created through the runner placeholder is considered extension
  owned and eligible for cleanup. If ownership cannot be verified during
  cleanup, its runner/tab reference is retained for a later retry and the tab is
  not closed.
- A scroll plateau is not reported as complete coverage. Group, post-search,
  and comment coverage stays `unknown` unless an exact end marker is visible;
  reaching a configured item limit is always `partial`.
- Facebook automation must only be enabled after the required platform,
  privacy, and legal approvals are in place.
