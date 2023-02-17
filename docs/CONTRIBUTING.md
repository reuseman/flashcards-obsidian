# Contributing

Contributions via bug reports, bug fixes, are welcome. If you have ideas about features to be implemented, please open an issue so we can discuss the best way to implement it.

## How to build?

You need to pull the repository, install the dependencies with `node` and then build with the command `npm run dev`. It will automatically move the files into the `docs/test-vault` and hot reload the plugin.

    $ git clone git@github.com:reuseman/flashcards-obsidian.git
    $ cd flashcards-obsidian
    ~/flashcards-obsidian$ npm install
    ~/flashcards-obsidian$ npm run dev

### Hot Reload

You need to download `main.js` and `manifest.json` from https://github.com/pjeby/hot-reload into `docs/test-vault/.obsidian/plugins/hot-reload` if you want to use the hot reload functionality mentioned above.
