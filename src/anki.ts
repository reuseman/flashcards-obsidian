import { TFile, Vault } from 'obsidian';
import { Card } from 'src/entities/card';

export class Anki {
    public async storeMediaFiles(cards: Card[]) {
        let actions: any[] = []

        console.log("IN anki.storeMediaFiles")
        for (let card of cards) {
            console.log(card)
            for (let media of card.getMedias()) {
                console.log("MEDIA")
                console.log(media)
                actions.push({
                    "action": "storeMediaFile",
                    "params": media
                })
            }
        }

        console.log("Actions created: ")
        console.log(actions)

        if (actions) {
            return this.invoke("multi", 6, { "actions": actions })
        } else {
            return {}
        }
    }

    public async addCards(cards: Card[]): Promise<number[]> {
        let notes: any = []

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

        // TODO add possibility to edit even tags
        // Unfortunately https://github.com/FooSoft/anki-connect/issues/183
        // This means that the delta from the current tags on Anki and the generated one should be added/removed

        for (let card of cards) {
            updateActions.push({
                "action": "updateNoteFields",
                "params": {
                    "note": card.getCard(true)
                }
            })
        }

        return this.invoke("multi", 6, { "actions": updateActions })
    }

    public async getCards(ids: number[]) {
        return await this.invoke("notesInfo", 6, { "notes": ids })
    }

    public async deleteCards(ids: number[]) {
        return this.invoke("deleteNotes", 6, { "notes": ids })
    }

    public async getDeck() {
        await this.invoke('createDeck', 6, { deck: 'test1' });
        const result = await this.invoke('deckNames', 6);
        console.log(`got list of decks: ${result}`);
        return result
    }

    public async ping(): Promise<boolean> {
        return await this.invoke('version', 6) === 6
    }

    private invoke(action: string, version: number, params = {}): any {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.addEventListener('error', () => reject('failed to issue request'));
            xhr.addEventListener('load', () => {
                try {
                    const response = JSON.parse(xhr.responseText);
                    if (Object.getOwnPropertyNames(response).length != 2) {
                        throw 'response has an unexpected number of fields';
                    }
                    if (!response.hasOwnProperty('error')) {
                        throw 'response is missing required error field';
                    }
                    if (!response.hasOwnProperty('result')) {
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
}
