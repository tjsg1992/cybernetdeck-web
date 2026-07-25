# NetDeck public site

This directory is the standalone public GitHub Pages package. It contains no
Sage of Light runtime or private database. Export it with:

```powershell
.\sagebot\.venv\Scripts\python.exe -c "from pathlib import Path; from sagebot.cardgame.static_site import build_static_site; build_static_site(Path('netdeck-web'))"
```

Copy this directory into the dedicated public `netdeck-web` repository. The
private Discord bot publishes approved tournament snapshots into
`data/tournaments/` using `NETDECK_GITHUB_REPOSITORY` and
`NETDECK_GITHUB_TOKEN` on its host.
