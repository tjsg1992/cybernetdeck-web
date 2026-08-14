# NetDeck public site

This directory is the standalone public GitHub Pages package. It contains no
Sage of Light runtime or private database. From the Sage of Light repository
root, the normal publisher reads the one-time Worker URL from
`cloudflare-deck-api/local-config.json`:

```powershell
cmd.exe /c publish-netdeck-pages.bat
```

Copy this directory into the dedicated public `netdeck-web` repository. The
private Discord bot publishes approved tournament snapshots into
`data/tournaments/` using `NETDECK_GITHUB_REPOSITORY` and
`NETDECK_GITHUB_TOKEN` on its host.
