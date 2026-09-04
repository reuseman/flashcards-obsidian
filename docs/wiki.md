# Flashcards v1 documentation

> [!IMPORTANT]
> This is the archived manual for Flashcards v1. The current version is
> [Flashcards v2](https://github.com/reuseman/flashcards-obsidian/blob/main/README.md).

## Table of contents
- [Requirements](#requirements)
- [Write cards](#write-cards)
  * [#card hashtag](#-card-hashtag)
  * [Inline style with ::](#inline-style-with---)
    + [Reverse](#reverse)
  * [Cloze](#cloze)
  * [Spaced with #card-spaced hashtag](#spaced-with-card-spaced-hashtag)
- [Generate cards on Anki](#generate-cards-on-anki)
  * [Insert](#insert)
  * [Update](#update)
  * [Delete](#delete)
- [Features](#features)
  * [Context-aware mode](#context-aware-mode)
  * [Deck](#deck)
    * [Folder-based deck name](#folder-based-deck-name)
  * [Tags](#tags)
  * [Images](#images)
  * [Code highlight support](#code-highlight-support)
  * [Source support](#source-support)
  * [LaTeX support](#latex-support)
- [Troubleshooting](#troubleshooting)
- [Customization](#customization)

<!--<small><i><a href='http://ecotrust-canada.github.io/markdown-toc/'>Table of contents generated with markdown-toc</a></i></small>-->

## Requirements
First, Anki and [AnkiConnect](https://ankiweb.net/shared/info/2055492159) should be running and configured properly, as explained [here](https://github.com/reuseman/flashcards-obsidian/blob/v1/README.md#how-to-install).

## Write cards
At the current time the hashtag is the way to define them. It can be customized in the settings, but the default one is `#card`.
Here there is an example file ([Preview](https://github.com/reuseman/flashcards-obsidian/blob/v1/docs/demo.md) | [Markdown](https://raw.githubusercontent.com/reuseman/flashcards-obsidian/v1/docs/demo.md)).

### #card hashtag
To mark a line or a heading as the **front** of a card just write a **#card** tag after it. On a new line write the **back** of the card. And remember to space things out!

```markdown
# This could be a title

## This is the front #card
This is the back of the card.

This line will not be part of it, because there is an empty line above.

### This is a normal and reversed card #card-reverse
Which means that two cards will be generated on Anki.

### Also revers #card/reverse
But this time it uses Obsidian hierarchical tags.

### This could be another question #card
But this time without the heading.

## This is another way to define the front
#card
This style is usefull to avoid the hashtags when referencing in Obsidian

```

### Inline style with ::
```markdown
# This could be a title

All of these works:
My question::My answer
My question:: My answer
My question ::My Answer
My question :: My answer

You can even use it in lists:
- My question:: My answer
```

#### Reverse
To create a reversed card with the inline style just use `:::`.
```markdown
All of these works:
My question:::My answer
My question::: My answer
My question :::My Answer
My question ::: My answer
```

### Cloze
```
This is a way to define a ==cloze== by using the Obsidian highlight syntax in order to avoid making notes dirty.
The alternative is this type of {cloze} that is totally equal to {1:cloze}. With the number you can specify the order {2:later cloze}.
```

### Spaced with #card-spaced hashtag
```markdown
This could be a beautifull quote that you want to see once in a while #card-spaced
```

Optionally, you can consider the `#card/spaced` alternative to use obsidian hierarchical tags.

## Generate cards on Anki
1. In Obsidian, open the file where you have the flashcards
2. Then to insert/update/delete just run inside Obsidian the command `Ctrl+p` and execute the command `Flashcards: generate for the current file`

### Insert
Write the cards and just run the command above. The insertion operation will add cards on Anki. While, in Obsidian it will add an ID to keep track of them.

### Update
Just edit the card in Obsidian, and run the command above.
**NOTE: Make certain that when you want to update the BROWSE window of Anki is closed.**
Unfortunately, this is a bug that is not my under control, but it's a problem tied up with the Anki APIs I am using.

### Delete
Delete the content of the card in Obsidian, but without deleting the ID. The plugin will take care of it. So for example
```markdown
## This is the front of the card to delete #card
This is the back of the card to delete.
^1607361487244
```
This is what you should leave:
```markdown
^1607361487244
```

## Features

### Context-aware mode
To make sense of notes, they should talk about a specific topic, so if you have two headings of level 1 (# heading), probably you should have two notes that talks about those topics. Moreover, the note itself is written with a tree-structure and then connected in a graph way. Based on this hypothesis, the context-aware mode creates the context in the **front** of the card. Where the context the outline of the headings in a tree structure. The demo shows is in action. This helps you out:
- **during review**, because the front will be **unique** and this helps the memory in reaching for the correct answer. If the front is repeated for multiple cards, it's impossible to remember what's in the back, it's pure randomness.
- **during writing**, because you can write following the same structure for different topics, and cards will always be **unique**. So you do not have to think too much about the writing itself.

**Example:**
```markdown
# Computer Science

## Languages #card
Stuff

### OOP #card
Stuff

#### C++ #card
Stuff

#### Java #card
Answer

### Functional
Stuff
```

**Generated card for the Java heading**

- With context-aware mode on 🟢
```
Front: Computer Science > Languages > OOP > Java
Back: Answer
```

- With context-aware mode off 🔴
```
Front: Java
Back: Answer
```

### Deck
To define in which deck in Anki the cards should go, write the name of the deck in the [front matter](https://publish.obsidian.md/help/Advanced+topics/YAML+front+matter). You can even specify sub decks by using two colons, `My Deck Name::Sub deck`. If you want to change the deck after the cards have been generated, just change the deck name.

```markdown
---
cards-deck: My Deck Name
---

## This is the front #card
This is the back of the card.
```
#### Folder-based deck name
This should be enabled in the settings. `Default: On`. It enables to automatically create cards into a deck that follows the hierarchical paths of where the note is.
For example, if you have a file in the path `food/italian/cavatelli.md`, then the cards will be generated in a deck named `food::italian`.

### Tags
To define the tags that should be used in Anki, there are two approaches.
- Global tags: takes all the tags specified after any line that starts with `tags:`. To hide them in the preview, just put them in the [front matter](https://publish.obsidian.md/help/Advanced+topics/YAML+front+matter) of Obsidian.
- Local tags: takes the tag after the #card tag.

```markdown
---
tags: global-tag1, global-tag2
---

## This is the front #card #my-local-tag
This is the back of the card.
```
Global tags can even be defined in this manner:
```markdown
tags: global-tag1, #global-tag2, [[global-tag3]]
```

or without the comma:
```markdown
tags: global-tag1 #global-tag2 [[global-tag3]]
```

### Images
To add images, just [embed](https://publish.obsidian.md/help/How+to/Embed+files) them normally.

### Code highlight support
This should be enabled in the settings. `Default: Off`

### Source support
This should be enabled in the settings. `Default: Off`
Note that whenever enabled, the previous cards created without the source support cannot be updated, unless you switch back. My suggestion is to stick with one mode.

### LaTeX support
Just write your latex code by using the Obsidian syntax:
```md
This is an example
$3+4$
$$50+2$$
```

## Troubleshooting
If you have some problem in the configuration step with Anki, open Anki annd `Tools -> Add-ons -> AnkiConnect -> Config`, paste the following:

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


## Customization
To have coloured tags for the flashcards one, you can use this in `obsidian.css`. It's not added directly in the plugin, to do not mess with your styles 😊.

```css
.tag {
  color: var(--text-normal);
  background-color: var(--text-accent);
  border: none;
  font-size: 11px;
  padding: 1px 8px;
  text-align: center;
  text-decoration: none;
  margin: 0px 0px;
  cursor: pointer;
  border-radius: 14px;
  display: inline;
  vertical-align: middle;
}

.tag:hover {
  color: var(--text-normal);
  background-color: var(--text-accent-hover);
}

.tag[href="#card"] {
  background-color: #821515;
}

.tag[href="#card-reverse"] {
  background-color: #821515;
}
```
