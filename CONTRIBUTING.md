# Contributing

Contributions via bug reports and bug fixes are welcome. For new features,
open an issue first so we can discuss the best way to implement it.

## How to build

Clone, install, and run the watch build. esbuild copies `main.js` +
`manifest.json` into `test-vault/.obsidian/plugins/flashcards-obsidian/`
on every successful rebuild, so reloading Obsidian picks up the change.

```sh
git clone git@github.com:reuseman/flashcards-obsidian.git
cd flashcards-obsidian
npm install
npm run dev
```
