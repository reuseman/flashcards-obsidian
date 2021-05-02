import { codeDeckExtension, sourceDeckExtension } from 'src/constants';
import { Card } from "src/entities/card";

export class Inlinecard extends Card {
    constructor(id: number = -1, deckName: string, initialContent: string, fields: Record<string, string>, reversed: boolean, endOffset: number, tags: string[] = [], inserted: boolean = false, mediaNames: string[], containsCode: boolean) {
        super(id, deckName, initialContent, fields, reversed, endOffset, tags, inserted, mediaNames, containsCode) // ! CHANGE []
        this.modelName = this.reversed ? `Obsidian-basic-reversed` : `Obsidian-basic`
        if (fields["Source"]) {
            this.modelName += sourceDeckExtension
        }
        if (containsCode) {
            this.modelName += codeDeckExtension
        }
    }

    public getCard(update: boolean = false): object {
        let card: any = {
            "deckName": this.deckName,
            "modelName": this.modelName,
            "fields": this.fields,
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
        return `Q: ${this.fields[0]} \nA: ${this.fields[1]} `
    }

    public getIdFormat(): string {
        return "^" + this.id.toString()
    }
}