import { Card } from "src/entities/card";

export class Flashcard extends Card {
    constructor(id: number = -1, deckName: string, initialContent: string, fields: Record<string, string>, reversed: boolean, endOffset: number, tags: string[] = [], inserted: boolean = false, mediaNames: string[]) {
        super(id, deckName, initialContent, fields, reversed, endOffset, tags, inserted, mediaNames)
    }

    public getCard(update: boolean = false): object {
        let modelName = this.reversed ? "Obsidian-basic-reversed" : "Obsidian-basic"
        let card: any = {
            "deckName": this.deckName,
            "modelName": modelName,
            "fields": {
                "Front": this.fields["Front"],
                "Back": this.fields["Back"]
            },
            "tags": this.tags,
        }

        if (update) {
            card["id"] = this.id
        }

        return card
    }

    public getMedias(): object[] {
        let medias: object[] = []
        this.mediaBase64Encoded.forEach((data, index) => {
            medias.push({
                "filename": this.mediaNames[index],
                "data": data
            })
        })

        return medias
    }

    public toString = (): string => {
        return `Q: ${this.fields[0]}\nA: ${this.fields[1]}`
    }
}