import { codeDeckExtension } from 'src/constants'
import { arraysEqual } from 'src/utils'

export abstract class Card {
    id: number
    deckName: string
    initialContent: string
    fields: Record<string, string>
    reversed: boolean
    endOffset: number
    tags: string[]
    inserted: boolean
    mediaNames: string[]
    mediaBase64Encoded: string[]
    oldTags: string[]
    containsCode: boolean
    modelName: string

    // TODO set "obsidian as optional in the settings", this means that the tag should be outside
    constructor(id: number, deckName: string, initialContent: string, fields: Record<string, string>, reversed: boolean, endOffset: number, tags: string[], inserted: boolean, mediaNames: string[], containsCode: boolean = false) {
        this.id = id
        this.deckName = deckName
        this.initialContent = initialContent
        this.fields = fields
        this.reversed = reversed
        this.endOffset = endOffset
        this.tags = tags
        this.tags.unshift("obsidian")
        this.inserted = inserted
        this.mediaNames = mediaNames
        this.mediaBase64Encoded = []
        this.oldTags = []
        this.containsCode = containsCode
        this.modelName = ""
    }

    abstract toString(): string
    abstract getCard(update: boolean): object
    abstract getMedias(): object[]
    abstract getIdFormat(): string

    match(card: any): boolean {
        // TODO not supported currently
        // if (this.modelName !== card.modelName) {
        //     return false
        // }

        let fields = Object.entries(card.fields)
        // This is the case of a switch from a model to another one. It cannot be handeled
        if (fields.length !== Object.entries(this.fields).length) {
            return true
        }

        for (let field of fields) {
            let fieldName = field[0]
            if (field[1].value !== this.fields[fieldName]) {
                return false
            }
        }

        return arraysEqual(card.tags, this.tags)
    }

    getCodeDeckNameExtension() {
        return this.containsCode ? codeDeckExtension : ""
    }
}