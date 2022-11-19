import { Card } from "src/entities/card";
import {
  sourceField,
  codeScript,
  highlightjsBase64,
  hihglightjsInitBase64,
  highlightCssBase64,
  codeDeckExtension,
  sourceDeckExtension,
} from "src/conf/constants";
import * as templates from "./templates";

interface ModelParams {
  modelName: string;
  inOrderFields: string[];
  css: string;
  isCloze: boolean;
  cardTemplates: { Name: string; Front: string; Back: string }[];
}

interface Model {
  action: string;
  params: ModelParams;
}

export class Anki {
  public async createModels(sourceSupport: boolean, codeHighlightSupport: boolean) {
    let models = this.getModels(sourceSupport, false);
    if (codeHighlightSupport) {
      models = models.concat(this.getModels(sourceSupport, true));
    }

    return this.invoke("multi", 6, { actions: models });
  }

  public async createDeck(deckName: string): Promise<any> {
    return this.invoke("createDeck", 6, { deck: deckName });
  }

  public async storeMediaFiles(cards: Card[]) {
    const actions: any[] = [];

    for (const card of cards) {
      for (const media of card.getMedias()) {
        actions.push({
          action: "storeMediaFile",
          params: media,
        });
      }
    }

    if (actions) {
      return this.invoke("multi", 6, { actions: actions });
    } else {
      return {};
    }
  }

  public async storeCodeHighlightMedias() {
    const fileExists = await this.invoke("retrieveMediaFile", 6, {
      filename: "_highlightInit.js",
    });

    if (!fileExists) {
      const highlightjs = {
        action: "storeMediaFile",
        params: {
          filename: "_highlight.js",
          data: highlightjsBase64,
        },
      };
      const highlightjsInit = {
        action: "storeMediaFile",
        params: {
          filename: "_highlightInit.js",
          data: hihglightjsInitBase64,
        },
      };
      const highlightjcss = {
        action: "storeMediaFile",
        params: {
          filename: "_highlight.css",
          data: highlightCssBase64,
        },
      };
      return this.invoke("multi", 6, {
        actions: [highlightjs, highlightjsInit, highlightjcss],
      });
    }
  }

  public async addCards(cards: Card[]): Promise<number[]> {
    const notes: any = [];

    cards.forEach((card) => notes.push(card.getCard(false)));

    return this.invoke("addNotes", 6, {
      notes: notes,
    });
  }

  /**
   * Given the new cards with an optional deck name, it updates all the cards on Anki.
   *
   * Be aware of https://github.com/FooSoft/anki-connect/issues/82. If the Browse pane is opened on Anki,
   * the update does not change all the cards.
   * @param cards the new cards.
   * @param deckName the new deck name.
   */
  public async updateCards(cards: Card[]): Promise<any> {
    let updateActions: any[] = [];

    // Unfortunately https://github.com/FooSoft/anki-connect/issues/183
    // This means that the delta from the current tags on Anki and the generated one should be added/removed
    // That's what the current approach does, but in the future if the API it is made more consistent
    //  then mergeTags(...) is not needed anymore
    const ids: number[] = [];

    for (const card of cards) {
      updateActions.push({
        action: "updateNoteFields",
        params: {
          note: card.getCard(true),
        },
      });

      updateActions = updateActions.concat(this.mergeTags(card.oldTags, card.tags, card.id));
      ids.push(card.id);
    }

    // Update deck
    updateActions.push({
      action: "changeDeck",
      params: {
        cards: ids,
        deck: cards[0].deckName,
      },
    });

    return this.invoke("multi", 6, { actions: updateActions });
  }

  public async changeDeck(ids: number[], deckName: string) {
    return await this.invoke("changeDeck", 6, { cards: ids, deck: deckName });
  }

  public async cardsInfo(ids: number[]) {
    return await this.invoke("cardsInfo", 6, { cards: ids });
  }

  public async getCards(ids: number[]) {
    return await this.invoke("notesInfo", 6, { notes: ids });
  }

  public async deleteCards(ids: number[]) {
    return this.invoke("deleteNotes", 6, { notes: ids });
  }

  public async ping(): Promise<boolean> {
    return (await this.invoke("version", 6)) === 6;
  }

  private mergeTags(oldTags: string[], newTags: string[], cardId: number) {
    const actions = [];

    // Find tags to Add
    for (const tag of newTags) {
      const index = oldTags.indexOf(tag);
      if (index > -1) {
        oldTags.splice(index, 1);
      } else {
        actions.push({
          action: "addTags",
          params: {
            notes: [cardId],
            tags: tag,
          },
        });
      }
    }

    // All Tags to delete
    for (const tag of oldTags) {
      actions.push({
        action: "removeTags",
        params: {
          notes: [cardId],
          tags: tag,
        },
      });
    }

    return actions;
  }

  private invoke(action: string, version = 6, params = {}): any {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.addEventListener("error", () => reject("failed to issue request"));
      xhr.addEventListener("load", () => {
        try {
          const response = JSON.parse(xhr.responseText);
          if (Object.getOwnPropertyNames(response).length != 2) {
            throw "response has an unexpected number of fields";
          }
          if (!Object.prototype.hasOwnProperty.call(response, "error")) {
            throw "response is missing required error field";
          }
          if (!Object.prototype.hasOwnProperty.call(response, "result")) {
            throw "response is missing required result field";
          }
          if (response.error) {
            throw response.error;
          }
          resolve(response.result);
        } catch (e) {
          reject(e);
        }
      });

      xhr.open("POST", "http://127.0.0.1:8765");
      xhr.send(JSON.stringify({ action, version, params }));
    });
  }

  private getModels(sourceSupport: boolean, codeHighlightSupport: boolean): Model[] {
    const sourceExtension = sourceSupport ? sourceDeckExtension : "";
    const sourceFieldContent = sourceSupport ? sourceField : "";
    const codeExtension = codeHighlightSupport ? codeDeckExtension : "";
    const codeScriptContent = codeHighlightSupport ? codeScript : "";

    const css = templates.formatStyle();
    const front = templates.formatBasicFront(codeScriptContent);
    const back = templates.formatBasicBack(sourceFieldContent);
    const frontReversed = templates.formatReversedFront(codeScriptContent);
    const backReversed = templates.formatReversedBack(sourceFieldContent);
    const clozeFront = templates.formatClozeFront(codeScriptContent);
    const clozeBack = templates.formatClozeBack(sourceFieldContent, codeScriptContent);
    const prompt = templates.formatPromptFront(codeScriptContent);
    const promptBack = templates.formatPromptBack(sourceFieldContent);

    const makeModel = ({
      name,
      fields,
      templates,
      isCloze = false,
    }: {
      name: string;
      fields: string[];
      templates: { name: string; front: string; back: string }[];
      isCloze?: boolean;
    }): Model => {
      if (sourceSupport) {
        fields.push("Source");
      }

      return {
        action: "createModel",
        params: {
          modelName: `Obsidian-${name}${sourceExtension}${codeExtension}`,
          inOrderFields: fields,
          isCloze,
          css,
          cardTemplates: templates.map((t) => ({
            Name: t.name,
            Front: t.front,
            Back: t.back,
          })),
        },
      };
    };

    const basic = makeModel({
      name: "basic",
      fields: ["Front", "Back"],
      templates: [{ name: "Front / Back", front, back }],
    });
    const reversed = makeModel({
      name: "basic-reversed",
      fields: ["Front", "Back"],
      templates: [
        { name: "Front / Back", front, back },
        { name: "Back / Front", front: frontReversed, back: backReversed },
      ],
    });
    const cloze = makeModel({
      name: "cloze",
      fields: ["Text", "Extra"],
      isCloze: true,
      templates: [{ name: "Cloze", front: clozeFront, back: clozeBack }],
    });
    const spaced = makeModel({
      name: "spaced",
      fields: ["Prompt"],
      templates: [{ name: "Spaced", front: prompt, back: promptBack }],
    });

    return [basic, reversed, cloze, spaced];
  }

  public async requestPermission() {
    return this.invoke("requestPermission", 6);
  }
}
