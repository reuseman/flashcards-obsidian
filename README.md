# README

This is the [ohmjs](https://ohmjs.org/docs/intro) rewrite of the plugin. The main goal of the branch is to have a repo that contains the frontend parser that will output a json containing the parsed flashcards. In order to achieve this the grammar must be defined and parsed.

Currently ohmjs supports both Javascript and Typescript. The repo is setup in order to support both. I suggest to go the javascript way at the beginning and then refactor in typescript for the production. The reason is because especially at the beginning there is a lot of trial, compile and error cycle in order to define the grammar properly. By using typescript this cycle is slowed down significantly because of the compilation time.

## Quickstart

    npm run dev

The commands reads the grammar `src/assets/grammar.ohm' and the mock markdown file `src/assets/note.md` and outputs the parsed json in the console.

## Test
This is a work in progress and we need to figure out how to structure it properly to work with Obsidian.

    npm test