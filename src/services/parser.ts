import { Flashcard } from '../entities/flashcard';
import { ISettings } from 'src/settings';
import * as showdown from 'showdown';
import { Regex } from 'src/regex';
import { Inlinecard } from 'src/entities/inlinecard';
import { Spacedcard } from 'src/entities/spacedcard';

export class Parser {
    private regex: Regex
    private settings: ISettings
    private htmlConverter

    constructor(regex: Regex, settings: ISettings) {
        this.regex = regex
        this.settings = settings
        this.htmlConverter = new showdown.Converter()
        this.htmlConverter.setOption("simplifiedAutoLink", true)
        this.htmlConverter.setOption("tables", true)
        this.htmlConverter.setOption("tasks", true)
        this.htmlConverter.setOption("ghCodeBlocks", true)
    }

    public generateFlashcards(file: string, deck: string, vault: string, globalTags: string[] = []): Flashcard[] {
        let contextAware = this.settings.contextAwareMode
        let cards: Flashcard[] = []
        let headings: any = []

        if (contextAware) {
            // https://regex101.com/r/agSp9X/4
            headings = [...file.matchAll(this.regex.headingsRegex)]
        }

        cards = cards.concat(this.generateCardsWithTag(file, headings, deck, vault, globalTags))
        cards = cards.concat(this.generateInlineCards(file, headings, deck, vault, globalTags))
        cards = cards.concat(this.generateSpacedCards(file, headings, deck, vault, globalTags))
        cards.sort((a, b) => a.endOffset - b.endOffset)

        return cards
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

    private generateSpacedCards(file: string, headings: any, deck: string, vault: string, globalTags: string[] = []) {
        let contextAware = this.settings.contextAwareMode
        let cards: Spacedcard[] = []
        let matches = [...file.matchAll(this.regex.cardsSpacedStyle)]

        for (let match of matches) {
            let reversed: boolean = false
            let headingLevel = -1
            if (match[1]) {
                headingLevel = match[1].trim().length !== 0 ? match[1].trim().length : -1
            }
            // Match.index - 1 because otherwise in the context there will be even match[1], i.e. the question itself
            let context = contextAware ? this.getContext(headings, match.index - 1, headingLevel) : ""

            let originalPrompt = match[2].trim()
            let prompt = contextAware ? [...context, match[2].trim()].join(`${this.settings.contextSeparator}`) : match[2].trim()
            let imagesMedia: string[] = this.getImageLinks(prompt)
            prompt = this.parseLine(prompt, vault)

            let endingLine = match.index + match[0].length
            let tags: string[] = this.parseTags(match[4], globalTags)
            let id: number = match[5] ? Number(match[5]) : -1
            let inserted: boolean = match[5] ? true : false
            let fields = { "Prompt": prompt }
            let containsCode = this.containsCode([prompt])

            let card = new Spacedcard(id, deck, originalPrompt, fields, reversed, endingLine, tags, inserted, imagesMedia, containsCode)
            cards.push(card)
        }

        return cards
    }

    private generateInlineCards(file: string, headings: any, deck: string, vault: string, globalTags: string[] = []) {
        let contextAware = this.settings.contextAwareMode
        let cards: Inlinecard[] = []
        let matches = [...file.matchAll(this.regex.cardsInlineStyle)]

        for (let match of matches) {
            let reversed: boolean = false
            let headingLevel = -1
            if (match[1]) {
                headingLevel = match[1].trim().length !== 0 ? match[1].trim().length : -1
            }
            // Match.index - 1 because otherwise in the context there will be even match[1], i.e. the question itself
            let context = contextAware ? this.getContext(headings, match.index - 1, headingLevel) : ""

            let originalQuestion = match[2].trim()
            let question = contextAware ? [...context, match[2].trim()].join(`${this.settings.contextSeparator}`) : match[2].trim()
            let answer = match[3].trim()
            let imagesMedia: string[] = this.getImageLinks(question)
            imagesMedia = imagesMedia.concat(this.getImageLinks(answer))
            question = this.parseLine(question, vault)
            answer = this.parseLine(answer, vault)

            let endingLine = match.index + match[0].length
            let tags: string[] = this.parseTags(match[4], globalTags)
            let id: number = match[5] ? Number(match[5]) : -1
            let inserted: boolean = match[5] ? true : false
            let fields = { "Front": question, "Back": answer }
            let containsCode = this.containsCode([question, answer])

            let card = new Inlinecard(id, deck, originalQuestion, fields, reversed, endingLine, tags, inserted, imagesMedia, containsCode)
            cards.push(card)
        }

        return cards
    }

    private generateCardsWithTag(file: string, headings: any, deck: string, vault: string, globalTags: string[] = []) {
        let contextAware = this.settings.contextAwareMode
        let cards: Flashcard[] = []
        let matches = [...file.matchAll(this.regex.flashscardsWithTag)]

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
            question = this.parseLine(question, vault)
            answer = this.parseLine(answer, vault)

            let endingLine = match.index + match[0].length
            let tags: string[] = this.parseTags(match[4], globalTags)
            let id: number = match[6] ? Number(match[6]) : -1
            let inserted: boolean = match[6] ? true : false
            let fields = { "Front": question, "Back": answer }
            let containsCode = this.containsCode([question, answer])

            let card = new Flashcard(id, deck, originalQuestion, fields, reversed, endingLine, tags, inserted, imagesMedia, containsCode)
            cards.push(card)
        }

        return cards
    }

    public containsCode(str: string[]): boolean {
        for (let s of str) {
            if (s.match(this.regex.codeBlock)) {
                return true
            }
        }
        return false
    }

    public getCardsToDelete(file: string): number[] {
        // Find block IDs with no content above it
        return [...file.matchAll(this.regex.cardsToDelete)].map((match) => { return Number(match[1]) })
    }

    private parseLine(str: string, vaultName: string) {
        return this.mathToAnki(this.htmlConverter.makeHtml(this.substituteObsidianLinks(this.substituteImageLinks(str), vaultName)))
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

    private substituteObsidianLinks(str: string, vaultName: string) {
        let linkRegex = /\[\[(.+?)\]\]/gmi
        let matches = [...str.matchAll(linkRegex)]
        vaultName = encodeURIComponent(vaultName)
        for (let match of matches) {
            let href = `obsidian://open?vault=${vaultName}&file=${encodeURIComponent(match[1])}.md`
            let link = `<a href="${href}">${match[0]}</a>`
            str = str.substring(0, match.index) + link + str.substring(match.index + match[0].length)
        }

        return str
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