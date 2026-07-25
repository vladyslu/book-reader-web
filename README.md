# Book Reader Web

This is the iPhone-friendly web reader for `.abrbook` packages.

## How It Works

- `Saved Books` are stored inside the browser on the iPhone and work away from home.
- `Home Library` is served by your PC while the phone is on the same Wi-Fi.
- There is no login, account, or cloud storage in this version.
- Do not publish private `.abrbook` files to GitHub.

## Publish The App

The GitHub Pages site should host the reader app shell, not your private book files.

```powershell
cd "C:\Users\vlady\Documents\Book Reader"
.\scripts\publish-web-reader-to-github.ps1
```

Open the Pages URL on iPhone, tap Share, then Add to Home Screen.

## Add Books To Home Library

On the PC:

```powershell
cd "C:\Users\vlady\Documents\Book Reader"
.\scripts\add-web-reader-book.ps1 -Book ".\exports\your-book.abrbook"
.\scripts\start-home-library.ps1
```

The server prints one or more iPhone URLs like:

```text
http://192.168.1.25:8765
```

On the iPhone, open the installed Book Reader, tap `Home PC`, enter that URL, then tap `Refresh`. Tap `Save` beside a Home Library book. After saving, it appears under `Saved Books` and works offline.

If the GitHub app cannot fetch the PC URL because of iOS browser limits, open the printed `http://...` URL directly on the iPhone while home and use the same `Save` button there. Private books still stay off GitHub.

## Remove Books

Remove a book from the PC Home Library:

```powershell
.\scripts\add-web-reader-book.ps1 -Book ".\exports\your-book.abrbook" -Remove
```

On the iPhone, `Delete` removes only the saved local copy from that phone.

## Reader Features

Saved books support page text, audio playback, seeking, bookmarks, image show/hide, reader font choice, sentence highlighting, speaker color highlights with a legend, and tap-word definitions. In the definition panel, use `Move Audio Here` to jump narration to that word.
