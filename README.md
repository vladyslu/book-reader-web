# Book Reader Web

This is the GitHub Pages version of Book Reader.

## Publish

Create a public GitHub repository that contains the files in this `web-reader` folder at the repository root, then push to `main`.

GitHub Actions will publish the site to GitHub Pages. Open the Pages URL on iPhone, tap Share, then Add to Home Screen.

Do not upload private `.abrbook` files to GitHub. Use the cloud sync setup below for account-based private storage.

## Cloud books

The web app supports real account login and synced books through Supabase. A signed-in user can import an `.abrbook` on the PC, upload it to the private cloud account, then sign in on iPhone and tap `Save` to store the book locally for offline reading.

Setup:

1. Create a free Supabase project.
2. In Supabase SQL Editor, run `supabase-schema.sql`.
3. In Supabase Project Settings, copy the Project URL and anon public key.
4. From the main project folder, run:

```powershell
.\scripts\configure-web-reader-cloud.ps1 -SupabaseUrl "https://YOUR-PROJECT.supabase.co" -SupabaseAnonKey "YOUR-ANON-KEY"
.\scripts\publish-web-reader-to-github.ps1
```

5. Open the app on PC, sign in or create an account, then import `.abrbook` files.
6. Open the app on iPhone with the same account, tap `Refresh`, then tap `Save` beside a cloud book.

`Stay logged in` keeps the account session on that device. If it is unchecked during sign-in, the session stays for the browser session only.

## Public hosted books

Optional hosted books live in `books/` and are listed in `books/library.json`. Anything placed there is public through GitHub Pages.

Use the main project scripts:

```powershell
.\scripts\add-web-reader-book.ps1 -Book ".\exports\your-book.abrbook"
.\scripts\publish-web-reader-to-github.ps1
```

Then tap `Refresh` in the iPhone web app and `Save` the online book to local phone storage.

## Reader features

The phone reader uses the same `.abrbook` package data as the PC reader. Imported or saved books support page text, audio playback, seeking, bookmarks, image show/hide, sentence highlighting, speaker color highlights with a legend, and tap-word definitions. In the definition panel, use `Move Audio Here` to jump narration to that word.
