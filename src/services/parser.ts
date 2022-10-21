import { ISettings } from "src/conf/settings";
import * as showdown from "showdown";
import { Regex } from "src/conf/regex";
import { Flashcard } from "../entities/flashcard";
import { Inlinecard } from "src/entities/inlinecard";
import { Spacedcard } from "src/entities/spacedcard";
import { Clozecard } from "src/entities/clozecard";
import { escapeMarkdown } from "src/utils";
import { Card } from "src/entities/card";
import { htmlToMarkdown } from 'obsidian';

export class Parser {
  private regex: Regex;
  private settings: ISettings;
  private htmlConverter;

  constructor(regex: Regex, settings: ISettings) {
    this.regex = regex;
    this.settings = settings;
    this.htmlConverter = new showdown.Converter();
    this.htmlConverter.setOption("simplifiedAutoLink", true);
    this.htmlConverter.setOption("tables", true);
    this.htmlConverter.setOption("tasks", true);
    this.htmlConverter.setOption("strikethrough", true);
    this.htmlConverter.setOption("ghCodeBlocks", true);
    this.htmlConverter.setOption("requireSpaceBeforeHeadingText", true);
    this.htmlConverter.setOption("simpleLineBreaks", true);
  }

  public generateFlashcards(
    file: string,
    deck: string,
    vault: string,
    note: string,
    globalTags: string[] = []
  ): Flashcard[] {
    const contextAware = this.settings.contextAwareMode;
    let cards: Flashcard[] = [];
    let headings: any = [];

    if (contextAware) {
      // https://regex101.com/r/agSp9X/4
      headings = [...file.matchAll(this.regex.headingsRegex)];
    }

    note = this.substituteObsidianLinks(`[[${note}]]`, vault);
    cards = cards.concat(
      this.generateCardsWithTag(file, headings, deck, vault, note, globalTags)
    );
    cards = cards.concat(
      this.generateInlineCards(file, headings, deck, vault, note, globalTags)
    );
    cards = cards.concat(
      this.generateSpacedCards(file, headings, deck, vault, note, globalTags)
    );
    cards = cards.concat(
      this.generateClozeCards(file, headings, deck, vault, note, globalTags)
    );

    // Filter out cards that are fully inside a code block, a math block or a math inline block
    const codeBlocks = [...file.matchAll(this.regex.obsidianCodeBlock)];
    const mathBlocks = [...file.matchAll(this.regex.mathBlock)];
    const mathInline = [...file.matchAll(this.regex.mathInline)];
    const blocksToFilter = [...codeBlocks, ...mathBlocks, ...mathInline];
    const rangesToDiscard = blocksToFilter.map(x => ([x.index, x.index + x[0].length]))
    cards = cards.filter(card => {
      const cardRange = [card.initialOffset, card.endOffset];
      const isInRangeToDiscard = rangesToDiscard.some(range => {
        return (
          cardRange[0] >= range[0] && cardRange[1] <= range[1]
        );
      });
      return !isInRangeToDiscard;
    });

    cards.sort((a, b) => a.endOffset - b.endOffset);

    const defaultAnkiTag = this.settings.defaultAnkiTag;
    if (defaultAnkiTag) {
      for (const card of cards) {
        card.tags.push(defaultAnkiTag);
      }
    }

    return cards;
  }

  /**
   * Gives back the ancestor headings of a line.
   * @param headings The list of all the headings available in a file.
   * @param line The line whose ancestors need to be calculated.
   * @param headingLevel The level of the first ancestor heading, i.e. the number of #.
   */
  private getContext(
    headings: any,
    index: number,
    headingLevel: number
  ): string[] {
    const context: string[] = [];
    let currentIndex: number = index;
    let goalLevel = 6;

    let i = headings.length - 1;
    // Get the level of the first heading before the index (i.e. above the current line)
    if (headingLevel !== -1) {
      // This is the case of a #flashcard in a heading
      goalLevel = headingLevel - 1;
    } else {
      // Find first heading and its level
      // This is the case of a #flashcard in a paragraph
      for (i; i >= 0; i--) {
        if (headings[i].index < currentIndex) {
          currentIndex = headings[i].index;
          goalLevel = headings[i][1].length - 1;

          context.unshift(headings[i][2].trim());
          break;
        }
      }
    }

    // Search for the other headings
    for (i; i >= 0; i--) {
      const currentLevel = headings[i][1].length;
      if (currentLevel == goalLevel && headings[i].index < currentIndex) {
        currentIndex = headings[i].index;
        goalLevel = currentLevel - 1;

        context.unshift(headings[i][2].trim());
      }
    }

    return context;
  }

  private generateSpacedCards(
    file: string,
    headings: any,
    deck: string,
    vault: string,
    note: string,
    globalTags: string[] = []
  ) {
    const contextAware = this.settings.contextAwareMode;
    const cards: Spacedcard[] = [];
    const matches = [...file.matchAll(this.regex.cardsSpacedStyle)];

    for (const match of matches) {
      const reversed = false;
      let headingLevel = -1;
      if (match[1]) {
        headingLevel =
          match[1].trim().length !== 0 ? match[1].trim().length : -1;
      }
      // Match.index - 1 because otherwise in the context there will be even match[1], i.e. the question itself
      const context = contextAware
        ? this.getContext(headings, match.index - 1, headingLevel)
        : "";

      const originalPrompt = match[2].trim();
      let prompt = contextAware
        ? [...context, match[2].trim()].join(
          `${this.settings.contextSeparator}`
        )
        : match[2].trim();
      let medias: string[] = this.getImageLinks(prompt);
      medias = medias.concat(this.getAudioLinks(prompt));
      prompt = this.parseLine(prompt, vault);

      const initialOffset = match.index;
      const endingLine = match.index + match[0].length;
      const tags: string[] = this.parseTags(match[4], globalTags);
      const id: number = match[5] ? Number(match[5]) : -1;
      const inserted: boolean = match[5] ? true : false;
      const fields: any = { Prompt: prompt };
      if (this.settings.sourceSupport) {
        fields["Source"] = note;
      }
      const containsCode = this.containsCode([prompt]);

      const card = new Spacedcard(
        id,
        deck,
        originalPrompt,
        fields,
        reversed,
        initialOffset,
        endingLine,
        tags,
        inserted,
        medias,
        containsCode
      );
      cards.push(card);
    }

    return cards;
  }

  private generateClozeCards(
    file: string,
    headings: any,
    deck: string,
    vault: string,
    note: string,
    globalTags: string[] = []
  ) {
    const contextAware = this.settings.contextAwareMode;
    const cards: Clozecard[] = [];
    const matches = [...file.matchAll(this.regex.cardsClozeWholeLine)];

    const mathBlocks = [...file.matchAll(this.regex.mathBlock)];
    const mathInline = [...file.matchAll(this.regex.mathInline)];
    const blocksToFilter = [...mathBlocks, ...mathInline];
    const rangesToDiscard = blocksToFilter.map(x => ([x.index, x.index + x[0].length]))

    for (const match of matches) {
      const reversed = false;
      let headingLevel = -1;
      if (match[1]) {
        headingLevel =
          match[1].trim().length !== 0 ? match[1].trim().length : -1;
      }
      // Match.index - 1 because otherwise in the context there will be even match[1], i.e. the question itself
      const context = contextAware
        ? this.getContext(headings, match.index - 1, headingLevel)
        : "";

      // If all the curly clozes are inside a math block, then do not create the card
      const curlyClozes = match[2].matchAll(this.regex.singleClozeCurly);
      const matchIndex = match.index;
      // Identify curly clozes, drop all the ones that are in math blocks i.e. ($\frac{1}{12}$) and substitute the others with Anki syntax
      let clozeText = match[2].replace(this.regex.singleClozeCurly, (match, g1, g2, g3, offset) => {
        const globalOffset = matchIndex + offset;
        const isInMathBlock = rangesToDiscard.some(x => (globalOffset >= x[0] && globalOffset + match[0].length <= x[1]));
        if (isInMathBlock) {
          return match;
        } else {
          if (g2) {
            return `{{c${g2}::${g3}}}`;
          } else {
            return `{{c1::${g3}}}`;
          }
        }
      });

      // Replace the highlight clozes in the line with Anki syntax
      clozeText = clozeText.replace(this.regex.singleClozeHighlight, "{{c1::$2}}");

      if (clozeText === match[2]) {
        // If the clozeText is the same as the match it means that the curly clozes were all in math blocks
        continue;
      }

      const originalLine = match[2].trim();
      // Add context
      clozeText = contextAware
        ? [...context, clozeText.trim()].join(
          `${this.settings.contextSeparator}`
        )
        : clozeText.trim();
      let medias: string[] = this.getImageLinks(clozeText);
      medias = medias.concat(this.getAudioLinks(clozeText));
      clozeText = this.parseLine(clozeText, vault);

      const initialOffset = match.index;
      const endingLine = match.index + match[0].length;
      const tags: string[] = this.parseTags(match[4], globalTags);
      const id: number = match[5] ? Number(match[5]) : -1;
      const inserted: boolean = match[5] ? true : false;
      const fields: any = { Text: clozeText, Extra: "" };
      if (this.settings.sourceSupport) {
        fields["Source"] = note;
      }
      const containsCode = this.containsCode([clozeText]);

      const card = new Clozecard(
        id,
        deck,
        originalLine,
        fields,
        reversed,
        initialOffset,
        endingLine,
        tags,
        inserted,
        medias,
        containsCode
      );
      cards.push(card);
    }

    return cards;
  }

  private generateInlineCards(
    file: string,
    headings: any,
    deck: string,
    vault: string,
    note: string,
    globalTags: string[] = []
  ) {
    const contextAware = this.settings.contextAwareMode;
    const cards: Inlinecard[] = [];
    const matches = [...file.matchAll(this.regex.cardsInlineStyle)];

    for (const match of matches) {
      if (
        match[2].toLowerCase().startsWith("cards-deck") ||
        match[2].toLowerCase().startsWith("tags")
      ) {
        continue;
      }

      const reversed: boolean = match[3] === this.settings.inlineSeparatorReverse;
      let headingLevel = -1;
      if (match[1]) {
        headingLevel =
          match[1].trim().length !== 0 ? match[1].trim().length : -1;
      }
      // Match.index - 1 because otherwise in the context there will be even match[1], i.e. the question itself
      const context = contextAware
        ? this.getContext(headings, match.index - 1, headingLevel)
        : "";

      const originalQuestion = match[2].trim();
      let question = contextAware
        ? [...context, match[2].trim()].join(
          `${this.settings.contextSeparator}`
        )
        : match[2].trim();
      let answer = match[4].trim();
      let medias: string[] = this.getImageLinks(question);
      medias = medias.concat(this.getImageLinks(answer));
      medias = medias.concat(this.getAudioLinks(answer));
      question = this.parseLine(question, vault);
      answer = this.parseLine(answer, vault);

      const initialOffset = match.index
      const endingLine = match.index + match[0].length;
      const tags: string[] = this.parseTags(match[5], globalTags);
      const id: number = match[6] ? Number(match[6]) : -1;
      const inserted: boolean = match[6] ? true : false;
      const fields: any = { Front: question, Back: answer };
      if (this.settings.sourceSupport) {
        fields["Source"] = note;
      }
      const containsCode = this.containsCode([question, answer]);

      const card = new Inlinecard(
        id,
        deck,
        originalQuestion,
        fields,
        reversed,
        initialOffset,
        endingLine,
        tags,
        inserted,
        medias,
        containsCode
      );
      cards.push(card);
    }

    return cards;
  }

  private generateCardsWithTag(
    file: string,
    headings: any,
    deck: string,
    vault: string,
    note: string,
    globalTags: string[] = []
  ) {
    const contextAware = this.settings.contextAwareMode;
    const cards: Flashcard[] = [];
    const matches = [...file.matchAll(this.regex.flashscardsWithTag)];

    const embedMap = this.getEmbedMap();

    for (const match of matches) {
      const reversed: boolean =
        match[3].trim().toLowerCase() ===
        `#${this.settings.flashcardsTag}-reverse` ||
        match[3].trim().toLowerCase() ===
        `#${this.settings.flashcardsTag}/reverse`;
      const headingLevel = match[1].trim().length !== 0 ? match[1].length : -1;
      // Match.index - 1 because otherwise in the context there will be even match[1], i.e. the question itself
      const context = contextAware
        ? this.getContext(headings, match.index - 1, headingLevel).concat([])
        : "";

      const originalQuestion = match[2].trim();
      let question = contextAware
        ? [...context, match[2].trim()].join(
          `${this.settings.contextSeparator}`
        )
        : match[2].trim();
      let answer = match[5].trim();
      let medias: string[] = this.getImageLinks(question);
      medias = medias.concat(this.getImageLinks(answer));
      medias = medias.concat(this.getAudioLinks(answer));

      answer = this.getEmbedWrapContent(embedMap, answer);

      question = this.parseLine(question, vault);
      answer = this.parseLine(answer, vault);

      const initialOffset = match.index
      const endingLine = match.index + match[0].length;
      const tags: string[] = this.parseTags(match[4], globalTags);
      const id: number = match[6] ? Number(match[6]) : -1;
      const inserted: boolean = match[6] ? true : false;
      const fields: any = { Front: question, Back: answer };
      if (this.settings.sourceSupport) {
        fields["Source"] = note;
      }
      const containsCode = this.containsCode([question, answer]);

      const card = new Flashcard(
        id,
        deck,
        originalQuestion,
        fields,
        reversed,
        initialOffset,
        endingLine,
        tags,
        inserted,
        medias,
        containsCode
      );
      cards.push(card);
    }

    return cards;
  }

  public containsCode(str: string[]): boolean {
    for (const s of str) {
      if (s.match(this.regex.codeBlock)) {
        return true;
      }
    }
    return false;
  }

  public getCardsToDelete(file: string): number[] {
    // Find block IDs with no content above it
    return [...file.matchAll(this.regex.cardsToDelete)].map((match) => {
      return Number(match[1]);
    });
  }

  private parseLine(str: string, vaultName: string) {
    return this.htmlConverter.makeHtml(
      this.mathToAnki(
        this.substituteObsidianLinks(
          this.substituteImageLinks(this.substituteAudioLinks(str)),
          vaultName
        )
      )
    );
  }

  private getImageLinks(str: string) {
    const wikiMatches = str.matchAll(this.regex.wikiImageLinks);
    const markdownMatches = str.matchAll(this.regex.markdownImageLinks);
    const links: string[] = [];

    for (const wikiMatch of wikiMatches) {
      links.push(wikiMatch[1]);
    }

    for (const markdownMatch of markdownMatches) {
      links.push(decodeURIComponent(markdownMatch[1]));
    }

    return links;
  }

  private getAudioLinks(str: string) {
    const wikiMatches = str.matchAll(this.regex.wikiAudioLinks);
    const links: string[] = [];

    for (const wikiMatch of wikiMatches) {
      links.push(wikiMatch[1]);
    }

    return links;
  }

  private substituteObsidianLinks(str: string, vaultName: string) {
    const linkRegex = /\[\[(.+?)(?:\|(.+?))?\]\]/gim;
    vaultName = encodeURIComponent(vaultName);

    return str.replace(linkRegex, (match, filename, rename) => {
      const href = `obsidian://open?vault=${vaultName}&file=${encodeURIComponent(
        filename
      )}.md`;
      const fileRename = rename ? rename : filename;
      return `<a href="${href}">${fileRename}</a>`;
    });
  }

  private substituteImageLinks(str: string): string {
    str = str.replace(this.regex.wikiImageLinks, "<img src='$1'>");
    str = str.replace(this.regex.markdownImageLinks, "<img src='$1'>");

    return str;
  }

  private substituteAudioLinks(str: string): string {
    return str.replace(this.regex.wikiAudioLinks, "[sound:$1]");
  }

  private mathToAnki(str: string) {
    str = str.replace(this.regex.mathBlock, function (match, p1, p2) {
      return "\\\\[" + escapeMarkdown(p2) + " \\\\]";
    });

    str = str.replace(this.regex.mathInline, function (match, p1, p2) {
      return "\\\\(" + escapeMarkdown(p2) + "\\\\)";
    });

    return str;
  }

  private parseTags(str: string, globalTags: string[]): string[] {
    const tags: string[] = [...globalTags];

    if (str) {
      for (const tag of str.split("#")) {
        let newTag = tag.trim();
        if (newTag) {
          // Replace obsidian hierarchy tags delimeter \ with anki delimeter ::
          newTag = newTag.replace(this.regex.tagHierarchy, "::");
          tags.push(newTag);
        }
      }
    }

    return tags;
  }

  public getAnkiIDsBlocks(file: string): RegExpMatchArray[] {
    return Array.from(file.matchAll(/\^(\d{13})\s*/gm));
  }

  private getEmbedMap() {

    // key：link url 
    // value： embed content parse from html document
    const embedMap = new Map()

    var embedList = Array.from(document.documentElement.getElementsByClassName('internal-embed'));


    Array.from(embedList).forEach((el) => {
      // markdown-embed-content markdown-embed-page
      var embedValue = this.htmlConverter.makeMarkdown(this.htmlConverter.makeHtml(el.outerHTML).toString());

      var embedKey = el.getAttribute("src");
      embedMap.set(embedKey, embedValue);

      // console.log("embedKey: \n" + embedKey);
      // console.log("embedValue: \n" + embedValue);
    });

    return embedMap;
  }

  private getEmbedWrapContent(embedMap: Map<any, any>, embedContent: string): string {
    var result = embedContent.match(this.regex.embedBlock);
    while (result = this.regex.embedBlock.exec(embedContent)) {
      // console.log("result[0]: " + result[0]);
      // console.log("embedMap.get(result[1]): " + embedMap.get(result[1]));
      embedContent = embedContent.concat(embedMap.get(result[1]));
    }
    return embedContent;
  }

}
