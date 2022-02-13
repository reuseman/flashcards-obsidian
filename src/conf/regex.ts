import { ISettings } from "src/conf/settings";

export class Regex {
  headingsRegex: RegExp;
  wikiImageLinks: RegExp;
  markdownImageLinks: RegExp;
  wikiAudioLinks: RegExp;
  obsidianCodeBlock: RegExp; // ```code block``
  codeBlock: RegExp;
  mathBlock: RegExp; // $$ latex $$
  mathInline: RegExp; // $ latex $
  cardsDeckLine: RegExp;
  cardsToDelete: RegExp;
  globalTagsSplitter: RegExp;
  tagHierarchy: RegExp;

  flashscardsWithTag: RegExp;
  cardsInlineStyle: RegExp;
  cardsSpacedStyle: RegExp;
  cardsClozeWholeLine: RegExp;
  singleClozeCurly: RegExp;
  singleClozeHighlight: RegExp;
  clozeHighlight: RegExp;

  constructor(settings: ISettings) {
    this.update(settings);
  }

  public update(settings: ISettings) {
    // https://regex101.com/r/BOieWh/1
    this.headingsRegex = /^ {0,3}(#{1,6}) +([^\n]+?) ?((?: *#\S+)*) *$/gim;

    // Supported images https://publish.obsidian.md/help/How+to/Embed+files
    this.wikiImageLinks =
      /!\[\[(.*\.(?:png|jpg|jpeg|gif|bmp|svg|tiff)).*?\]\]/gim;
    this.markdownImageLinks =
      /!\[\]\((.*\.(?:png|jpg|jpeg|gif|bmp|svg|tiff)).*?\)/gim;

    this.wikiAudioLinks =
      /!\[\[(.*\.(?:mp3|webm|wav|m4a|ogg|3gp|flac)).*?\]\]/gim;

    // https://regex101.com/r/eqnJeW/1
    this.obsidianCodeBlock = /(?:```(?:.*?\n?)+?```)(?:\n|$)/gim;

    this.codeBlock = /<code\b[^>]*>(.*?)<\/code>/gims;

    this.mathBlock = /(\$\$)(.*?)(\$\$)/gis;
    this.mathInline = /(\$)(.*?)(\$)/gi;

    this.cardsDeckLine = /cards-deck: [\p{L}]+/giu;
    this.cardsToDelete = /^\s*(?:\n)(?:\^(\d{13}))(?:\n\s*?)?/gm;

    // https://regex101.com/r/WxuFI2/1
    this.globalTagsSplitter =
      /\[\[(.*?)\]\]|#([\p{L}:\-_/]+)|([\p{L}:\-_/]+)/gimu;
    this.tagHierarchy = /\//gm;

    // Cards
    const flags = "gimu";
    // https://regex101.com/r/p3yQwY/2
    let str =
      "( {0,3}[#]*)((?:[^\\n]\\n?)+?)(#" +
      settings.flashcardsTag +
      "(?:[/-]reverse)?)((?: *#[\\p{Letter}\\-\\/_]+)*) *?\\n+((?:[^\\n]\\n?)*?(?=\\^\\d{13}|$))(?:\\^(\\d{13}))?";
    this.flashscardsWithTag = new RegExp(str, flags);

    // https://regex101.com/r/8wmOo8/1
    const sepLongest = settings.inlineSeparator.length >= settings.inlineSeparatorReverse.length ? settings.inlineSeparator : settings.inlineSeparatorReverse;
    const sepShortest = settings.inlineSeparator.length < settings.inlineSeparatorReverse.length ? settings.inlineSeparator : settings.inlineSeparatorReverse;
    // sepLongest is the longest between the inlineSeparator and the inlineSeparatorReverse because if the order is ::|::: then always the first will be matched
    // sepShortest is the shortest
    if (settings.inlineID) {
      str =
        "( {0,3}[#]{0,6})?(?:(?:[\\t ]*)(?:\\d.|[-+*]|#{1,6}))?(.+?) ?(" + sepLongest + "|" + sepShortest + ") ?(.+?)((?: *#[\\p{Letter}\\-\\/_]+)+)?(?:\\s+\\^(\\d{13})|$)";
    } else {
      str =
        "( {0,3}[#]{0,6})?(?:(?:[\\t ]*)(?:\\d.|[-+*]|#{1,6}))?(.+?) ?(" + sepLongest + "|" + sepShortest + ") ?(.+?)((?: *#[\\p{Letter}\\-\\/_]+)+|$)(?:\\n\\^(\\d{13}))?";
    }
    this.cardsInlineStyle = new RegExp(str, flags);

    // https://regex101.com/r/HOXF5E/1
    str =
      "( {0,3}[#]*)((?:[^\\n]\\n?)+?)(#" +
      settings.flashcardsTag +
      "[/-]spaced)((?: *#[\\p{Letter}-]+)*) *\\n?(?:\\^(\\d{13}))?";
    this.cardsSpacedStyle = new RegExp(str, flags);

    // https://regex101.com/r/cgtnLf/1

    str = "( {0,3}[#]{0,6})?(?:(?:[\\t ]*)(?:\\d.|[-+*]|#{1,6}))?(.*?(==.+?==|\\{.+?\\}).*?)((?: *#[\\w\\-\\/_]+)+|$)(?:\n\\^(\\d{13}))?"
    this.cardsClozeWholeLine = new RegExp(str, flags);
    
    this.singleClozeCurly = /((?:{)(?:(\d):?)?(.+?)(?:}))/g;
    this.singleClozeHighlight = /((?:==)(.+?)(?:==))/g;
  }
}