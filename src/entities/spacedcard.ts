import { Card } from "src/entities/card";

export class Spacedcard extends Card {
    constructor(id: number = -1, deckName: string, initialContent: string, fields: Record<string, string>, reversed: boolean, endOffset: number, tags: string[] = [], inserted: boolean = false, mediaNames: string[], containsCode: boolean) {
        super(id, deckName, initialContent, fields, reversed, endOffset, tags, inserted, mediaNames, containsCode)
        let codeExtension = this.getCodeDeckNameExtension()
        this.modelName = `Obsidian-spaced${codeExtension}`
    }

    public getCard(update: boolean = false): object {

        let card: any = {
            "deckName": this.deckName,
            "modelName": this.modelName,
            "fields": {
                "Prompt": this.fields["Prompt"],
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
        return `Prompt: ${this.fields[0]}`
    }

    public getIdFormat(): string {
        return "^" + this.id.toString() + "\n"
    }
}