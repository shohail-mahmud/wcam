<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep gesture classification and stability in a browser-safe, DOM-free module so pose rules can be tested independently of webcam models.
- The standalone camera page owns camera, debug, and fullscreen controls; the host iframe must allow camera and fullscreen access.
- Uploaded overlay media uses Lovable Assets pointers; the standalone module references their generated URLs because it is served without a bundler.
