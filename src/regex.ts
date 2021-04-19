import { ISettings } from 'src/settings';

export class Regex {
    headingsRegex: RegExp
    wikiImageLinks: RegExp
    markdownImageLinks: RegExp
    codeBlock: RegExp
    cardsDeckLine: RegExp
    cardsToDelete: RegExp
    flashscardsWithTag: RegExp
    cardsInlineStyle: RegExp
    cardsSpacedStyle: RegExp

    constructor(settings: ISettings) {
        this.update(settings)
    }

    public update(settings: ISettings) {
        // https://regex101.com/r/BOieWh/1
        this.headingsRegex = /^ {0,3}(#{1,6}) +([^\n]+?) ?((?: *#\S+)*) *$/gim

        // Supported images https://publish.obsidian.md/help/How+to/Embed+files
        this.wikiImageLinks = /!\[\[(.*\.(?:png|jpg|jpeg|gif|bmp|svg|tiff)).*?\]\]/gim
        this.markdownImageLinks = /!\[\]\((.*\.(?:png|jpg|jpeg|gif|bmp|svg|tiff)).*?\)/gim
        this.codeBlock = /<code\b[^>]*>(.*?)<\/code>/gims

        this.cardsDeckLine = /cards-deck: [\w\d]+/gi
        this.cardsToDelete = /^\s*(?:\n)(?:\^(\d{13}))(?:\n\s*?)?/gm

        // Cards
        // https://regex101.com/r/p3yQwY/2
        let str = "( {0,3}[#]*)((?:[^\\n]\\n?)+?)(#" + settings.flashcardsTag + "(?:-reverse)?)((?: *#[\\w-]+)*) *?\\n+((?:[^\\n]\\n?)*?(?=\\^\\d{13}|$))(?:\\^(\\d{13}))?"
        this.flashscardsWithTag = new RegExp(str, "gim")

        // https://regex101.com/r/Ixtzlv/1
        str = "( {0,3}[#]{0,6})?(?:(?:[\\t ]*)(?:\\d.|[-+*]|#{1,6}))?(.+?) ?(:{2,3}) ?(.+?)((?: *#[\\w-]+)+|$)(?:\\n\\^(\\d{13}))?"
        this.cardsInlineStyle = new RegExp(str, "gim")

        // https://regex101.com/r/HOXF5E/1
        str = "( {0,3}[#]*)((?:[^\\n]\\n?)+?)(#card-spaced)((?: *#[\\w-]+)*) *\\n?(?:\\^(\\d{13}))?"
        this.cardsSpacedStyle = new RegExp(str, "gim")
    }
}
