import { Card } from 'src/entities/card';
import { sourceField, codeScript, highlightjsBase64, hihglightjsInitBase64, highlightCssBase64, codeDeckExtension, sourceDeckExtension } from 'src/constants'

export class Anki {
    public async createModels(sourceSupport: boolean, codeHighlightSupport: boolean,) {
        let models = this.getModels(sourceSupport, false)
        if (codeHighlightSupport) {
            models = models.concat(this.getModels(sourceSupport, true))
        }

        return this.invoke("multi", 6, { "actions": models })
    }

    public async createDeck(deckName: string): Promise<any> {
        return this.invoke("createDeck", 6, { "deck": deckName })
    }

    public async storeMediaFiles(cards: Card[]) {
        const actions: any[] = []

        for (const card of cards) {
            for (const media of card.getMedias()) {
                actions.push({
                    "action": "storeMediaFile",
                    "params": media
                })
            }
        }

        if (actions) {
            return this.invoke("multi", 6, { "actions": actions })
        } else {
            return {}
        }
    }

    public async storeCodeHighlightMedias() {
        const fileExists = await this.invoke(
            "retrieveMediaFile",
            6,
            {
                "filename": "_highlightInit.js"
            })

        if (!fileExists) {
            const highlightjs = {
                "action": "storeMediaFile", "params": {
                    "filename": "_highlight.js",
                    "data": highlightjsBase64
                }
            }
            const highlightjsInit = {
                "action": "storeMediaFile", "params": {
                    "filename": "_highlightInit.js",
                    "data": hihglightjsInitBase64
                }
            }
            const highlightjcss = {
                "action": "storeMediaFile", "params": {
                    "filename": "_highlight.css",
                    "data": highlightCssBase64
                }
            }
            return this.invoke("multi", 6, { "actions": [highlightjs, highlightjsInit, highlightjcss] })
        }
    }

    public async addCards(cards: Card[]): Promise<number[]> {
        const notes: any = []

        cards.forEach(card => notes.push(card.getCard(false)))

        return this.invoke("addNotes", 6, {
            "notes": notes
        })
    }

    /**
     * Given the new cards with an optional deck name, it updates all the cards on Anki.
     * 
     * Be aware of https://github.com/FooSoft/anki-connect/issues/82. If the Browse pane is opened on Anki,
     * the update does not change all the cards.
     * @param cards the new cards.
     * @param deckName the new deck name.
     */
    public async updateCards(cards: Card[]): Promise<any> {
        let updateActions: any[] = []



        // Unfortunately https://github.com/FooSoft/anki-connect/issues/183
        // This means that the delta from the current tags on Anki and the generated one should be added/removed
        // That's what the current approach does, but in the future if the API it is made more consistent
        //  then mergeTags(...) is not needed anymore 
        const ids: number[] = []

        for (const card of cards) {
            updateActions.push({
                "action": "updateNoteFields",
                "params": {
                    "note": card.getCard(true)
                }
            })

            updateActions = updateActions.concat(this.mergeTags(card.oldTags, card.tags, card.id))
            ids.push(card.id)
        }

        // Update deck
        updateActions.push({
            "action": "changeDeck",
            "params": {
                "cards": ids,
                "deck": cards[0].deckName
            }
        })

        return this.invoke("multi", 6, { "actions": updateActions })
    }

    public async changeDeck(ids: number[], deckName: string) {
        return await this.invoke("changeDeck" , 6, {"cards" : ids, "deck": deckName})
    }

    public async cardsInfo(ids: number[]) {
        return await this.invoke("cardsInfo" , 6, {"cards" : ids})
    }

    public async getCards(ids: number[]) {
        return await this.invoke("notesInfo", 6, { "notes": ids })
    }

    public async deleteCards(ids: number[]) {
        return this.invoke("deleteNotes", 6, { "notes": ids })
    }

    public async ping(): Promise<boolean> {
        return await this.invoke('version', 6) === 6
    }

    private mergeTags(oldTags: string[], newTags: string[], cardId: number) {
        const actions = []

        // Find tags to Add
        for (const tag of newTags) {
            const index = oldTags.indexOf(tag)
            if (index > -1) {
                oldTags.splice(index, 1)
            } else {
                actions.push({
                    "action": "addTags",
                    "params": {
                        "notes": [cardId],
                        "tags": tag,
                    }
                })
            }
        }

        // All Tags to delete
        for (const tag of oldTags) {
            actions.push({
                "action": "removeTags",
                "params": {
                    "notes": [cardId],
                    "tags": tag,
                }
            })
        }

        return actions
    }

    private invoke(action: string, version = 6, params = {}): any {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.addEventListener('error', () => reject('failed to issue request'));
            xhr.addEventListener('load', () => {
                try {
                    const response = JSON.parse(xhr.responseText);
                    if (Object.getOwnPropertyNames(response).length != 2) {
                        throw 'response has an unexpected number of fields';
                    }
                    if (!Object.prototype.hasOwnProperty.call(response, "error")) {
                        throw 'response is missing required error field';
                    }
                    if (!Object.prototype.hasOwnProperty.call(response, "result")) {
                        throw 'response is missing required result field';
                    }
                    if (response.error) {
                        throw response.error;
                    }
                    resolve(response.result);
                } catch (e) {
                    reject(e);
                }
            });

            xhr.open('POST', 'http://127.0.0.1:8765');
            xhr.send(JSON.stringify({ action, version, params }));
        });
    }

    private getModels(sourceSupport: boolean, codeHighlightSupport: boolean): object[] {
        let sourceFieldContent = ""
        let codeScriptContent = ""
        let sourceExtension = ""
        let codeExtension = ""
        if (sourceSupport) {
            sourceFieldContent = "\r\n" + sourceField
            sourceExtension = sourceDeckExtension
        }

        if (codeHighlightSupport) {
            codeScriptContent = "\r\n" + codeScript + "\r\n"
            codeExtension = codeDeckExtension
        }

        const css = ".card {\r\n font-family: arial;\r\n font-size: 20px;\r\n text-align: center;\r\n color: black;\r\n background-color: white;\r\n}\r\n\r\n.tag::before {\r\n\tcontent: \"#\";\r\n}\r\n\r\n.tag {\r\n  color: white;\r\n  background-color: #9F2BFF;\r\n  border: none;\r\n  font-size: 11px;\r\n  font-weight: bold;\r\n  padding: 1px 8px;\r\n  margin: 0px 3px;\r\n  text-align: center;\r\n  text-decoration: none;\r\n  cursor: pointer;\r\n  border-radius: 14px;\r\n  display: inline;\r\n  vertical-align: middle;\r\n}\r\n"
        const front = `{{Front}}\r\n<p class=\"tags\">{{Tags}}<\/p>\r\n\r\n<script>\r\n    var tagEl = document.querySelector(\'.tags\');\r\n    var tags = tagEl.innerHTML.split(\' \');\r\n    var html = \'\';\r\n    tags.forEach(function(tag) {\r\n\tif (tag) {\r\n\t    var newTag = \'<span class=\"tag\">\' + tag + \'<\/span>\';\r\n           html += newTag;\r\n    \t    tagEl.innerHTML = html;\r\n\t}\r\n    });\r\n    \r\n<\/script>${codeScriptContent}`
        const back = `{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}${sourceFieldContent}`
        const frontReversed = `{{Back}}\r\n<p class=\"tags\">{{Tags}}<\/p>\r\n\r\n<script>\r\n    var tagEl = document.querySelector(\'.tags\');\r\n    var tags = tagEl.innerHTML.split(\' \');\r\n    var html = \'\';\r\n    tags.forEach(function(tag) {\r\n\tif (tag) {\r\n\t    var newTag = \'<span class=\"tag\">\' + tag + \'<\/span>\';\r\n           html += newTag;\r\n    \t    tagEl.innerHTML = html;\r\n\t}\r\n    });\r\n    \r\n<\/script>${codeScriptContent}`
        const backReversed = `{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}${sourceFieldContent}`
        const prompt = `{{Prompt}}\r\n<p class=\"tags\">🧠spaced {{Tags}}<\/p>\r\n\r\n<script>\r\n    var tagEl = document.querySelector(\'.tags\');\r\n    var tags = tagEl.innerHTML.split(\' \');\r\n    var html = \'\';\r\n    tags.forEach(function(tag) {\r\n\tif (tag) {\r\n\t    var newTag = \'<span class=\"tag\">\' + tag + \'<\/span>\';\r\n           html += newTag;\r\n    \t    tagEl.innerHTML = html;\r\n\t}\r\n    });\r\n    \r\n<\/script>${codeScriptContent}`
        const promptBack = `{{FrontSide}}\n\n<hr id=answer>🧠 Review done.${sourceFieldContent}`

        let classicFields = ["Front", "Back"]
        let promptFields = ["Prompt"]
        if (sourceSupport) {
            classicFields = classicFields.concat("Source")
            promptFields = promptFields.concat("Source")
        }

        const obsidianBasic = {
            "action": "createModel",
            "params": {
                "modelName": `Obsidian-basic${sourceExtension}${codeExtension}`,
                "inOrderFields": classicFields,
                "css": css,
                "cardTemplates": [
                    {
                        "Name": "Front / Back",
                        "Front": front,
                        "Back": back,
                    }
                ]
            }
        }

        const obsidianBasicReversed = {
            "action": "createModel",
            "params": {
                "modelName": `Obsidian-basic-reversed${sourceExtension}${codeExtension}`,
                "inOrderFields": classicFields,
                "css": css,
                "cardTemplates": [
                    {
                        "Name": "Front / Back",
                        "Front": front,
                        "Back": back,
                    },
                    {
                        "Name": "Back / Front",
                        "Front": frontReversed,
                        "Back": backReversed,
                    },
                ]
            }
        }

        const obsidianSpaced = {
            "action": "createModel",
            "params": {
                "modelName": `Obsidian-spaced${sourceExtension}${codeExtension}`,
                "inOrderFields": promptFields,
                "css": css,
                "cardTemplates": [
                    {
                        "Name": "Spaced",
                        "Front": prompt,
                        "Back": promptBack
                    }
                ]
            }
        }

        return [obsidianBasic, obsidianBasicReversed, obsidianSpaced]
    }
}
