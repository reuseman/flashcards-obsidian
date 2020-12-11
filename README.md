# Flashcards

[![GitHub release (latest SemVer)](https://img.shields.io/github/v/release/reuseman/flashcards-obsidian?style=for-the-badge&sort=semver)](https://github.com/reuseman/flashcards-obsidian/releases/latest)
![GitHub All Releases](https://img.shields.io/github/downloads/reuseman/flashcards-obsidian/total?style=for-the-badge)

Anki integration for [Obsidian](https://obsidian.md/).

## Features

🗃️ Simple flashcards with **#card**  
🎴 Reversed flashcards with **#card-reverse**  
✍️ Inline style with **Question::Answer**  
🧠 **Context-aware** mode  
🏷️ Global and local **tags**  
🔢 Support for **LaTeX**  
🖼️ Support for **images**  
🔗 **Obsidian URI** support

## How it works?

The following is a demo where the three main operations are shown:

1. **Insertion** of cards;
2. **Update** of cards;
3. **Deletion** of cards.

![Demo image](docs/demo.gif)

## How to use it?

The wiki explains in detail [how to use it](https://github.com/reuseman/flashcards-obsidian/wiki).

## How to install

1. Install this plugin on Obsidian

   From Obsidian v0.9.8+, you can activate this plugin within Obsidian by doing the following:

   - Open Settings > Third-party plugin
   - Make sure Safe mode is off
   - Click Browse community plugins
   - Search for "**Flashcards**"
   - Click Install
   - Once installed, close the community plugins window and activate the newly installed plugin

2. Install [AnkiConnect](https://ankiweb.net/shared/info/2055492159) on Anki
   - Tools > Add-ons -> Get Add-ons...
   - Paste the code **2055492159** > Ok
   - Select the plugin > Config > Paste the configuration below

Configuration:

    {
        "apiKey": null,
        "apiLogPath": null,
        "webBindAddress": "127.0.0.1",
        "webBindPort": 8765,
        "webCorsOrigin": "http://localhost",
        "webCorsOriginList": [
            "http://localhost",
            "app://obsidian.md"
        ]
    }
