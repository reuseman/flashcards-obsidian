import { Flashcard } from '../entities/flashcard';
import { Settings } from 'src/settings';
import * as showdown from 'showdown';
import { Regex } from 'src/regex';

export class Parser {
    private regex: Regex
    private settings: Settings
    private htmlConverter

    constructor(regex: Regex, settings: Settings) {
        this.regex = regex
        this.settings = settings
        this.htmlConverter = new showdown.Converter()
        this.htmlConverter.setOption("simplifiedAutoLink", true)
        this.htmlConverter.setOption("tables", true)
        this.htmlConverter.setOption("tasks", true)
    }


    /**
     * Gives back the ancestor headings of a line.
     * @param headings The list of all the headings available in a file.
     * @param line The line whose ancestors need to be calculated.
     * @param headingLevel The level of the first ancestor heading, i.e. the number of #.
     */
    private getContext(headings: any, index: number, headingLevel: number): string[] {
        let context: string[] = []
        let currentIndex: number = index
        let goalLevel: number = 6

        let i = headings.length - 1
        // Get the level of the first heading before the index (i.e. above the current line)
        if (headingLevel !== -1) {
            // This is the case of a #flashcard in a heading
            goalLevel = headingLevel - 1
        } else {
            // Find first heading and its level
            // This is the case of a #flashcard in a paragraph
            for (i; i >= 0; i--) {
                if (headings[i].index < currentIndex) {
                    currentIndex = headings[i].index
                    goalLevel = headings[i][1].length - 1

                    context.unshift(headings[i][2].trim())
                    break
                }
            }
        }

        // Search for the other headings
        for (i; i >= 0; i--) {
            let currentLevel = headings[i][1].length
            if (currentLevel == goalLevel && headings[i].index < currentIndex) {
                currentIndex = headings[i].index
                goalLevel = currentLevel - 1

                context.unshift(headings[i][2].trim())
            }
        }

        return context
    }


    public getCardsToDelete(file: string): number[] {
        // Find block IDs with no content above it
        const regex: RegExp = /^\s*(?:\n)(?:\^(\d{13}))(?:\n\s*?)?/gm // TODO move to regex
        return [...file.matchAll(regex)].map((match) => { return Number(match[1]) })
    }

    public generateFlashcards(file: string, globalTags: string[] = [], deckName: string): Flashcard[] {
        let contextAware = this.settings.contextAwareMode
        let flashcards: Flashcard[] = []

        // let regex: RegExp = /( {0,3}[#]*)((?:[^\n]\n?)+?)(#flashcard(?:-reverse)?)((?: *#\w+)*) *?\n+((?:[^\n]\n?)*?(?=\^\d{13}|$))(?:\^(\d{13}))?/gim
        let regex = this.regex.flashscardsWithTag
        let matches = [...file.matchAll(regex)]
        let headings: any = []

        if (contextAware) {
            // https://regex101.com/r/agSp9X/4
            headings = [...file.matchAll(this.regex.headingsRegex)]
        }

        for (let match of matches) {
            let reversed: boolean = match[3].trim().toLowerCase() === `#${this.settings.flashcardsTag}-reverse`
            let headingLevel = match[1].trim().length !== 0 ? match[1].length : -1
            // Match.index - 1 because otherwise in the context there will be even match[1], i.e. the question itself
            let context = contextAware ? this.getContext(headings, match.index - 1, headingLevel) : ""

            let originalQuestion = match[2].trim()
            let question = contextAware ? [...context, match[2].trim()].join(`${this.settings.contextSeparator}`) : match[2].trim()
            let answer = match[5].trim()
            let imagesMedia: string[] = this.getImageLinks(question)
            imagesMedia = imagesMedia.concat(this.getImageLinks(answer))
            question = this.substituteImageLinks(question)
            answer = this.substituteImageLinks(answer)
            question = this.mathToAnki(this.htmlConverter.makeHtml(question))
            answer = this.mathToAnki(this.htmlConverter.makeHtml(answer))

            let endingLine = match.index + match[0].length
            let tags: string[] = this.parseTags(match[4], globalTags)
            let id: number = match[6] ? Number(match[6]) : -1
            let inserted: boolean = match[6] ? true : false
            let fields = { "Front": question, "Back": answer }

            let flashcard = new Flashcard(id, deckName, originalQuestion, fields, reversed, endingLine, tags, inserted, imagesMedia)
            flashcards.push(flashcard)
        }

        return flashcards
    }

    private getImageLinks(str: string) {
        let wikiMatches = str.matchAll(this.regex.wikiImageLinks)
        let markdownMatches = str.matchAll(this.regex.markdownImageLinks)
        let links: string[] = []

        for (let wikiMatch of wikiMatches) {
            links.push(wikiMatch[1])
        }

        for (let markdownMatch of markdownMatches) {
            links.push(decodeURIComponent(markdownMatch[1]))
        }

        return links
    }

    private substituteImageLinks(str: string): string {
        str = str.replace(this.regex.wikiImageLinks, "<img src='$1'>")
        str = str.replace(this.regex.markdownImageLinks, "<img src='$1'>")

        return str
    }

    private mathToAnki(str: string) {
        let mathBlockRegex = /(\$\$)(.*)(\$\$)/gi
        str = str.replace(mathBlockRegex, '\\($2\\)')

        let mathInlineRegex = /(\$)(.*)(\$)/gi
        str = str.replace(mathInlineRegex, '\\($2\\)')

        return str
    }

    private parseTags(str: string, globalTags: string[]): string[] {
        let tags: string[] = [...globalTags]

        if (str) {
            for (let tag of str.split("#")) {
                tag = tag.trim()
                if (tag) {
                    tags.push(tag)
                }
            }
        }

        return tags
    }

    public getAnkiIDsBlocks(file: string): RegExpMatchArray[] {
        return Array.from(file.matchAll(/\^(\d{13})\s*/gm))
    }
}