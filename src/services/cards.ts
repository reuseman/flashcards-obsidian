import { Anki } from "src/services/anki";
import {
  App,
  FileSystemAdapter,
  FrontMatterCache,
  Notice,
  parseFrontMatterEntry,
  TFile,
} from "obsidian";
import { Parser } from "src/services/parser";
import { ISettings } from "src/conf/settings";
import { Card } from "src/entities/card";
import { arrayBufferToBase64 } from "src/utils";
import { Regex } from "src/conf/regex";
import { noticeTimeout } from "src/conf/constants";
import { Inlinecard } from "src/entities/inlinecard";

export class CardsService {
  private app: App;
  private settings: ISettings;
  private regex: Regex;
  private parser: Parser;
  private anki: Anki;

  private updateFile: boolean;
  private totalOffset: number;
  private file: string;
  private notifications: string[];

  constructor(app: App, settings: ISettings) {
    this.app = app;
    this.settings = settings;
    this.regex = new Regex(this.settings);
    this.parser = new Parser(this.regex, this.settings);
    this.anki = new Anki();
  }

  public async execute(activeFile: TFile): Promise<string[]> {
    this.regex.update(this.settings);

    try {
      await this.anki.ping();
    } catch (err) {
      console.error(err);
      return ["Error: Anki must be open with AnkiConnect installed."];
    }

    // Init for the execute phase
    this.updateFile = false;
    this.totalOffset = 0;
    this.notifications = [];
    const filePath = activeFile.basename;
    const sourcePath = activeFile.path;
    const fileCachedMetadata = this.app.metadataCache.getFileCache(activeFile);
    const vaultName = this.app.vault.getName();
    let globalTags: string[] = undefined;

    // Parse frontmatter
    const frontmatter = fileCachedMetadata.frontmatter;
    let deckName = "";
    if (parseFrontMatterEntry(frontmatter, "cards-deck")) {
      deckName = parseFrontMatterEntry(frontmatter, "cards-deck");
    } else if (this.settings.folderBasedDeck && activeFile.parent.path !== "/") {
      // If the current file is in the path "programming/java/strings.md" then the deck name is "programming::java"
      deckName = activeFile.parent.path.split("/").join("::");
    } else {
      deckName = this.settings.deck;
    }

    try {
      this.anki.storeCodeHighlightMedias();
      await this.anki.createModels(
        this.settings.sourceSupport,
        this.settings.codeHighlightSupport
      );
      await this.anki.createDeck(deckName);
      this.file = await this.app.vault.read(activeFile);
      if (!this.file.endsWith("\n")) {
        this.file += "\n";
      }
      globalTags = this.parseGlobalTags(this.file);
      // TODO with empty check that does not call ankiCards line
      const ankiBlocks = this.parser.getAnkiIDsBlocks(this.file);
      const ankiCards = ankiBlocks
        ? await this.anki.getCards(this.getAnkiIDs(ankiBlocks))
        : undefined;

      const cards: Card[] = this.parser.generateFlashcards(
        this.file,
        deckName,
        vaultName,
        filePath,
        globalTags
      );
      const [cardsToCreate, cardsToUpdate, cardsNotInAnki] =
        this.filterByUpdate(ankiCards, cards);
      const cardIds: number[] = this.getCardsIds(ankiCards, cards);
      const cardsToDelete: number[] = this.parser.getCardsToDelete(this.file);

      console.info("Flashcards: Cards to create");
      console.info(cardsToCreate);
      console.info("Flashcards: Cards to update");
      console.info(cardsToUpdate);
      console.info("Flashcards: Cards to delete");
      console.info(cardsToDelete);
      if (cardsNotInAnki) {
        console.info("Flashcards: Cards not in Anki (maybe deleted)");
        for (const card of cardsNotInAnki) {
          this.notifications.push(
            `Error: Card with ID ${card.id} is not in Anki!`
          );
        }
      }
      console.info(cardsNotInAnki);

      this.insertMedias(cards, sourcePath);
      await this.deleteCardsOnAnki(cardsToDelete, ankiBlocks);
      await this.updateCardsOnAnki(cardsToUpdate);
      await this.insertCardsOnAnki(cardsToCreate, frontmatter, deckName);

      // Update decks if needed
      const deckNeedToBeChanged = await this.deckNeedToBeChanged(
        cardIds,
        deckName
      );
      if (deckNeedToBeChanged) {
        try {
          this.anki.changeDeck(cardIds, deckName);
          this.notifications.push("Cards moved in new deck");
        } catch {
          return ["Error: Could not update deck the file."];
        }
      }

      // Update file
      if (this.updateFile) {
        try {
          this.app.vault.modify(activeFile, this.file);
        } catch (err) {
          Error("Could not update the file.");
          return ["Error: Could not update the file."];
        }
      }

      if (!this.notifications.length) {
        this.notifications.push("Nothing to do. Everything is up to date");
      }
      return this.notifications;
    } catch (err) {
      console.error(err);
      Error("Something went wrong");
    }
  }

  private async insertMedias(cards: Card[], sourcePath: string) {
    try {
      // Currently the media are created for every run, this is not a problem since Anki APIs overwrite the file
      // A more efficient way would be to keep track of the medias saved
      await this.generateMediaLinks(cards, sourcePath);
      await this.anki.storeMediaFiles(cards);
    } catch (err) {
      console.error(err);
      Error("Error: Could not upload medias");
    }
  }

  private async generateMediaLinks(cards: Card[], sourcePath: string) {
    if (this.app.vault.adapter instanceof FileSystemAdapter) {
      // @ts-ignore: Unreachable code error

      for (const card of cards) {
        for (const media of card.mediaNames) {
          const image = this.app.metadataCache.getFirstLinkpathDest(
            decodeURIComponent(media),
            sourcePath
          );
          try {
            const binaryMedia = await this.app.vault.readBinary(image);
            card.mediaBase64Encoded.push(arrayBufferToBase64(binaryMedia));
          } catch (err) {
            Error("Error: Could not read media");
          }
        }
      }
    }
  }

  private async insertCardsOnAnki(
    cardsToCreate: Card[],
    frontmatter: FrontMatterCache,
    deckName: string
  ): Promise<number> {
    if (cardsToCreate.length) {
      let insertedCards = 0;
      try {
        const ids = await this.anki.addCards(cardsToCreate);
        // Add IDs from response to Flashcard[]
        ids.map((id: number, index: number) => {
          cardsToCreate[index].id = id;
        });

        let total = 0;
        cardsToCreate.forEach((card) => {
          if (card.id === null) {
            new Notice(
              `Error, could not add: '${card.initialContent}'`,
              noticeTimeout
            );
          } else {
            card.reversed ? (insertedCards += 2) : insertedCards++;
          }
          card.reversed ? (total += 2) : total++;
        });

        this.updateFrontmatter(frontmatter, deckName);
        this.writeAnkiBlocks(cardsToCreate);

        this.notifications.push(
          `Inserted successfully ${insertedCards}/${total} cards.`
        );
        return insertedCards;
      } catch (err) {
        console.error(err);
        Error("Error: Could not write cards on Anki");
      }
    }
  }

  private updateFrontmatter(frontmatter: FrontMatterCache, deckName: string) {
    let newFrontmatter = "";
    const cardsDeckLine = `cards-deck: ${deckName}\n`;
    if (frontmatter) {
      if (deckName === obsidian.parseFrontMatterEntry(frontmatter, "cards-deck")) {
        console.log('Skipping frontmatter update, as there is no change in cards-deck');
        return;
      }
      const oldFrontmatter: string = this.file.substring(
        frontmatter.position.start.offset,
        frontmatter.position.end.offset
      );
      if (!oldFrontmatter.match(this.regex.cardsDeckLine)) {
        newFrontmatter =
          oldFrontmatter.substring(0, oldFrontmatter.length - 3) +
          cardsDeckLine +
          "---";
        this.totalOffset += cardsDeckLine.length;
        this.file =
          newFrontmatter +
          this.file.substring(
            frontmatter.position.end.offset,
            this.file.length + 1
          );
      }
    } else {
      newFrontmatter = `---\n${cardsDeckLine}---\n\n`;
      this.totalOffset += newFrontmatter.length;
      this.file = newFrontmatter + this.file;
    }
  }

  private writeAnkiBlocks(cardsToCreate: Card[]) {
    for (const card of cardsToCreate) {
      // Card.id cannot be null, because if written already previously it has an ID,
      //   if it has been inserted it has an ID too
      if (card.id !== null && !card.inserted) {
        let id = card.getIdFormat();
        if (card instanceof Inlinecard) {
          if (this.settings.inlineID) {
            id = " " + id;
          } else {
            id = "\n" + id;
          }
        }
        card.endOffset += this.totalOffset;
        const offset = card.endOffset;

        this.updateFile = true;
        this.file =
          this.file.substring(0, offset) +
          id +
          this.file.substring(offset, this.file.length + 1);
        this.totalOffset += id.length;
      }
    }
  }

  private async updateCardsOnAnki(cards: Card[]): Promise<number> {
    if (cards.length) {
      try {
        this.anki.updateCards(cards);
        this.notifications.push(
          `Updated successfully ${cards.length}/${cards.length} cards.`
        );
      } catch (err) {
        console.error(err);
        Error("Error: Could not update cards on Anki");
      }

      return cards.length;
    }
  }

  public async deleteCardsOnAnki(
    cards: number[],
    ankiBlocks: RegExpMatchArray[]
  ): Promise<number> {
    if (cards.length) {
      let deletedCards = 0;
      for (const block of ankiBlocks) {
        const id = Number(block[1]);

        // Deletion of cards that need to be deleted (i.e. blocks ID that don't have content)
        if (cards.includes(id)) {
          try {
            this.anki.deleteCards(cards);
            deletedCards++;

            this.updateFile = true;
            this.file =
              this.file.substring(0, block["index"]) +
              this.file.substring(
                block["index"] + block[0].length,
                this.file.length
              );
            this.totalOffset -= block[0].length;
            this.notifications.push(
              `Deleted successfully ${deletedCards}/${cards.length} cards.`
            );
          } catch (err) {
            console.error(err);
            Error("Error, could not delete the card from Anki");
          }
        }
      }

      return deletedCards;
    }
  }

  private getAnkiIDs(blocks: RegExpMatchArray[]): number[] {
    const IDs: number[] = [];
    for (const b of blocks) {
      IDs.push(Number(b[1]));
    }

    return IDs;
  }

  public filterByUpdate(ankiCards: any, generatedCards: Card[]) {
    let cardsToCreate: Card[] = [];
    const cardsToUpdate: Card[] = [];
    const cardsNotInAnki: Card[] = [];

    if (ankiCards) {
      for (const flashcard of generatedCards) {
        // Inserted means that anki blocks are available, that means that the card should
        // 	(the user can always delete it) be in Anki
        let ankiCard = undefined;
        if (flashcard.inserted) {
          ankiCard = ankiCards.filter(
            (card: any) => Number(card.noteId) === flashcard.id
          )[0];
          if (!ankiCard) {
            cardsNotInAnki.push(flashcard);
          } else if (!flashcard.match(ankiCard)) {
            flashcard.oldTags = ankiCard.tags;
            cardsToUpdate.push(flashcard);
          }
        } else {
          cardsToCreate.push(flashcard);
        }
      }
    } else {
      cardsToCreate = [...generatedCards];
    }

    return [cardsToCreate, cardsToUpdate, cardsNotInAnki];
  }

  public async deckNeedToBeChanged(cardsIds: number[], deckName: string) {
    const cardsInfo = await this.anki.cardsInfo(cardsIds);
    console.log("Flashcards: Cards info");
    console.log(cardsInfo);
    if (cardsInfo.length !== 0) {
      return cardsInfo[0].deckName !== deckName;
    }

    return false;
  }

  public getCardsIds(ankiCards: any, generatedCards: Card[]): number[] {
    let ids: number[] = [];

    if (ankiCards) {
      for (const flashcard of generatedCards) {
        let ankiCard = undefined;
        if (flashcard.inserted) {
          ankiCard = ankiCards.filter(
            (card: any) => Number(card.noteId) === flashcard.id
          )[0];
          if (ankiCard) {
            ids = ids.concat(ankiCard.cards);
          }
        }
      }
    }

    return ids;
  }

  public parseGlobalTags(file: string): string[] {
    let globalTags: string[] = [];

    const tags = file.match(/(?:cards-)?tags: ?(.*)/im);
    globalTags = tags ? tags[1].match(this.regex.globalTagsSplitter) : [];

    if (globalTags) {
      for (let i = 0; i < globalTags.length; i++) {
        globalTags[i] = globalTags[i].replace("#", "");
        globalTags[i] = globalTags[i].replace(/\//g, "::");
        globalTags[i] = globalTags[i].replace(/\[\[(.*)\]\]/, "$1");
        globalTags[i] = globalTags[i].trim();
        globalTags[i] = globalTags[i].replace(/ /g, "-");
      }

      return globalTags;
    }

    return [];
  }
}
