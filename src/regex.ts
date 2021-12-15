import { ISettings } from 'src/settings';

export class Regex {
    headingsRegex: RegExp
    wikiImageLinks: RegExp
    markdownImageLinks: RegExp
    wikiAudioLinks: RegExp
    codeBlock: RegExp
    cardsDeckLine: RegExp
    cardsToDelete: RegExp
    globalTagsSplitter: RegExp
    tagHierarchy: RegExp
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

        this.wikiAudioLinks = /!\[\[(.*\.(?:mp3|webm|wav|m4a|ogg|3gp|flac)).*?\]\]/gim

        this.codeBlock = /<code\b[^>]*>(.*?)<\/code>/gims

        this.cardsDeckLine = /cards-deck: [\p{L}]+/giu
        this.cardsToDelete = /^\s*(?:\n)(?:\^(\d{13}))(?:\n\s*?)?/gm

        // https://regex101.com/r/IS2gjL/1
        this.globalTagsSplitter = /\[\[(.*?)\]\]|#([\p{L}:\/-]+)|([\p{L}:]+)/gmiu
        this.tagHierarchy = /\//gm

        // Cards
        let flags = "gimu"
        // https://regex101.com/r/p3yQwY/2
        let str = "( {0,3}[#]*)((?:[^\\n]\\n?)+?)(#" + settings.flashcardsTag + "(?:[\/-]reverse)?)((?: *#[\\p{Letter}\\-\\/]+)*) *?\\n+((?:[^\\n]\\n?)*?(?=\\^\\d{13}|$))(?:\\^(\\d{13}))?"
        this.flashscardsWithTag = new RegExp(str, flags)

        // https://regex101.com/r/Ixtzlv/1
        if (settings.inlineID){
            str = "( {0,3}[#]{0,6})?(?:(?:[\\t ]*)(?:\\d.|[-+*]|#{1,6}))?(.+?) ?(:{2,3}) ?(.+?)((?: *#[\\p{Letter}\\-\\/]+)+)?(?:\\s+\\^(\\d{13})|$)"
        } else {
            str = "( {0,3}[#]{0,6})?(?:(?:[\\t ]*)(?:\\d.|[-+*]|#{1,6}))?(.+?) ?(:{2,3}) ?(.+?)((?: *#[\\p{Letter}\\-\\/]+)+|$)(?:\\n\\^(\\d{13}))?"
        }
        this.cardsInlineStyle = new RegExp(str, flags)

        // https://regex101.com/r/HOXF5E/1
        str = "( {0,3}[#]*)((?:[^\\n]\\n?)+?)(#" + settings.flashcardsTag + "[\/-]spaced)((?: *#[\\p{Letter}-]+)*) *\\n?(?:\\^(\\d{13}))?"
        this.cardsSpacedStyle = new RegExp(str, flags)
    }
}
