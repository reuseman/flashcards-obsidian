import { Settings } from 'src/settings';

export class Regex {
    headingsRegex: RegExp
    wikiImageLinks: RegExp
    markdownImageLinks: RegExp
    flashscardsWithTag: RegExp

    constructor(settings: Settings) {
        this.update(settings)
    }

    public update(settings: Settings) {
        // https://regex101.com/r/BOieWh/1
        this.headingsRegex = /^ {0,3}(#{1,6}) +([^\n]+?) ?((?: *#\S+)*) *$/gim

        // Supported images https://publish.obsidian.md/help/How+to/Embed+files
        this.wikiImageLinks = /!\[\[(.*\.(?:png|jpg|jpeg|gif|bmp|svg|tiff))\]\]/gim
        this.markdownImageLinks = /!\[\]\((.*\.(?:png|jpg|jpeg|gif|bmp|svg|tiff))\)/gim

        // Cards
        // https://regex101.com/r/p3yQwY/1
        let str = "( {0,3}[#]*)((?:[^\\n]\\n?)+?)(#" + settings.flashcardsTag + "(?:-reverse)?)((?: *#\\w+)*) *?\\n+((?:[^\\n]\\n?)*?(?=\\^\\d{13}|$))(?:\\^(\\d{13}))?"
        // this.flashscardsWithTag = new RegExp(this.escape(`( {0,3}[#]*)((?:[^\n]\n?)+?)(#${settings.flashcardsTag}(?:-reverse)?)((?: *#\w+)*) *?\n+((?:[^\n]\n?)*?(?=\^\d{13}|$))(?:\^(\d{13}))?`), "gim")
        // this.flashscardsWithTag = new RegExp(this.escape(str), "gim")
        // let myReg = /( {0,3}[#]*)((?:[^\n]\n?)+?)(#flashcard(?:-reverse)?)((?: *#\w+)*) *?\n+((?:[^\n]\n?)*?(?=\^\d{13}|$))(?:\^(\d{13}))?/gim
        this.flashscardsWithTag = new RegExp(str, "gim")
    }
}
