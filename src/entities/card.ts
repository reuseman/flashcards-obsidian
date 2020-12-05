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

    // TODO set "obsidian as optional in the settings", this means that the tag should be outside
    constructor(id: number, deckName: string, initialContent: string, fields: Record<string, string>, reversed: boolean, endOffset: number, tags: string[], inserted: boolean, mediaNames: string[]) {
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
    }

    abstract toString(): string
    abstract getCard(update: boolean): object
    abstract getMedias(): object[]

    match(card: any): boolean {
        let fields = Object.entries(card.fields)
        for (let field of fields) {
            let fieldName = field[0]
            if (field[1].value !== this.fields[fieldName]) {
                return false
            }
        }

        return true
    }
}