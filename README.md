# Book Reader Web

This is the GitHub Pages version of Book Reader.

## Publish

Create a public GitHub repository that contains the files in this `web-reader` folder at the repository root, then push to `main`.

GitHub Actions will publish the site to GitHub Pages. Open the Pages URL on iPhone, tap Share, then Add to Home Screen.

Do not upload `.abrbook` files to GitHub. Import book packages locally from Files/iCloud Drive after opening the web app on the phone.

## Hosted books

Optional hosted books live in `books/` and are listed in `books/library.json`. Anything placed there is public through GitHub Pages.

Use the main project scripts:

```powershell
.\scripts\add-web-reader-book.ps1 -Book ".\exports\your-book.abrbook"
.\scripts\publish-web-reader-to-github.ps1
```

Then tap `Refresh` in the iPhone web app and `Save` the online book to local phone storage.

## Reader features

The phone reader uses the same `.abrbook` package data as the PC reader. Imported or saved books support page text, audio playback, seeking, bookmarks, image show/hide, sentence highlighting, speaker color highlights with a legend, and tap-word definitions. In the definition panel, use `Move Audio Here` to jump narration to that word.

## App lock

The web app has a device app lock with `Stay logged in on this device`. It protects access to the reader UI on that browser/device. It does not protect hosted `.abrbook` files on public GitHub Pages.
