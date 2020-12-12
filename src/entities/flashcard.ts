import { Card } from "src/entities/card";

export class Flashcard extends Card {
    constructor(id: number = -1, deckName: string, initialContent: string, fields: Record<string, string>, reversed: boolean, endOffset: number, tags: string[] = [], inserted: boolean = false, mediaNames: string[], containsCode: boolean) {
        super(id, deckName, initialContent, fields, reversed, endOffset, tags, inserted, mediaNames, containsCode)
        let codeExtension = this.getCodeDeckNameExtension()
        this.modelName = this.reversed ? `Obsidian-basic-reversed${codeExtension}` : `Obsidian-basic${codeExtension}`
    }

    public getCard(update: boolean = false): object {
        let card: any = {
            "deckName": this.deckName,
            "modelName": this.modelName,
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

    public getIdFormat(): string {
        return "^" + this.id.toString() + "\n"
    }
}