import { Anki } from 'src/anki'
import { App, FileSystemAdapter, FrontMatterCache, Notice, parseFrontMatterEntry, parseFrontMatterTags, TFile } from 'obsidian'
import { Parser } from 'src/parser'
import { Settings } from 'src/settings'
import { Card } from 'src/entities/card'
import { Flashcard } from 'src/entities/flashcard'
import { arrayBufferToBase64 } from "src/utils"

export class CardsService {
    // TODO right now you do not check for cards that when inserted/updated gives back null as ID
    // TODO check the deletion for the reversed notes that have 2 cards bind
    private app: App
    private parser: Parser
    private anki: Anki
    private settings: Settings

    private updateFile: boolean
    private totalOffset: number
    private file: string
    private notifications: string[]

    constructor(app: App, settings: Settings) {
        this.app = app
        this.anki = new Anki()
        this.parser = new Parser(settings)
        this.settings = settings
    }

    public async execute(activeFile: TFile): Promise<string[]> {
        // TODO add note-type to Anki
        try {
            await this.anki.ping()
        } catch (err) {
            console.error(err)
            return ["Error: Anki must be open with AnkiConnect installed."]
        }

        // Init for the execute phase
        this.updateFile = false
        this.totalOffset = 0
        this.notifications = []
        let fileCachedMetadata = this.app.metadataCache.getFileCache(activeFile)
        let globalTags: string[] = undefined

        // Parse frontmatter 
        let frontmatter = fileCachedMetadata.frontmatter
        let deckName = this.settings.defaultDeck
        if (frontmatter) {
            deckName = parseFrontMatterEntry(frontmatter, "cards-deck")
            globalTags = parseFrontMatterTags(frontmatter).map(tag => tag.substr(1))
        }

        try {
            this.file = await this.app.vault.read(activeFile)
            // TODO with empty check that does not call ankiCards line
            let ankiBlocks = this.parser.getAnkiIDsBlocks(this.file)
            let ankiCards = ankiBlocks ? await this.anki.getCards(this.getAnkiIDs(ankiBlocks)) : undefined

            let cards: Flashcard[] = this.parser.generateFlashcards(this.file, globalTags, deckName)
            let [cardsToCreate, cardsToUpdate] = this.filterByUpdate(ankiCards, cards)
            let cardsToDelete: number[] = this.parser.getCardsToDelete(this.file)

            this.insertMedias(cards)
            await this.deleteCardsOnAnki(cardsToDelete, ankiBlocks)
            await this.updateCardsOnAnki(cardsToUpdate)
            await this.insertCardsOnAnki(cardsToCreate, frontmatter, deckName)

            // Update file
            if (this.updateFile) {
                try {
                    this.app.vault.modify(activeFile, this.file)
                } catch (err) {
                    Error("Could not update the file.")
                    return ["Error: Could not update the file."]
                }
            }

            if (!this.notifications.length) {
                this.notifications.push("Nothing to do. Everything is up to date")
            }
            return this.notifications
        } catch (err) {
            console.error(err)
            Error("Something went wrong")
        }
    }

    private async insertMedias(cards: Card[]) {
        try {
            // Currently the media are created for every run, this is not a problem since Anki APIs overwrite the file
            // A more efficient way would be to keep track of the medias saved
            await this.generateMediaLinks(cards)
            await this.anki.storeMediaFiles(cards)
        } catch (err) {
            console.error(err)
            Error("Error: Could not upload medias")
        }
    }

    private async generateMediaLinks(cards: Card[]) {
        if (this.app.vault.adapter instanceof FileSystemAdapter) {
            // @ts-ignore: Unreachable code error
            let attachmentsPath = this.app.vault.config.attachmentFolderPath

            for (let card of cards) {
                for (let media of card.mediaNames) {
                    let file: TFile = this.app.vault.getAbstractFileByPath(attachmentsPath + "/" + media) as TFile
                    try {
                        let binaryMedia = await this.app.vault.readBinary(file)
                        card.mediaBase64Encoded.push(arrayBufferToBase64(binaryMedia))
                    } catch (err) {
                        Error("Error: Could not read media")
                    }
                }
            };
        }
    }

    private async insertCardsOnAnki(cardsToCreate: Card[], frontmatter: FrontMatterCache, deckName: string): Promise<number> {
        if (cardsToCreate.length) {
            let insertedCards = 0
            // TODO before adding create deck if not exists
            // TODO check if cardsToCreate is not empty? 
            try {
                let ids = await this.anki.addCards(cardsToCreate)
                // Add IDs from response to Flashcard[]
                ids.map((id: number, index: number) => {
                    cardsToCreate[index].id = id
                })

                cardsToCreate.forEach(card => {
                    if (card.id === null) {
                        new Notice(`Error, could not add: '${card.initialContent}'`)
                    } else {
                        insertedCards++
                    }
                });

                this.updateFrontmatter(frontmatter, deckName)
                this.writeAnkiBlocks(cardsToCreate)

                this.notifications.push(`Inserted successfully ${insertedCards}/${cardsToCreate.length} cards.`)
                return insertedCards
            } catch (err) {
                console.error(err)
                Error("Error: Could not write cards on Anki")
            }
        }
    }

    private updateFrontmatter(frontmatter: FrontMatterCache, deckName: string) {
        // TODO evaluate https://regex101.com/r/bJySNf/1
        let newFrontmatter: string = ""
        let cardsDeckLine: string = `cards-deck: Default\n`
        if (frontmatter) {
            let oldFrontmatter: string = this.file.substring(frontmatter.position.start.offset, frontmatter.position.end.offset)
            if (!deckName) {
                newFrontmatter = oldFrontmatter.substring(0, oldFrontmatter.length - 3) + cardsDeckLine + "---"
                this.totalOffset += cardsDeckLine.length
                this.file = newFrontmatter + this.file.substring(frontmatter.position.end.offset, this.file.length + 1)
            }
        } else {
            newFrontmatter = `---\n${cardsDeckLine}---\n`
            this.totalOffset += newFrontmatter.length
            this.file = newFrontmatter + this.file
        }
    }

    private writeAnkiBlocks(cardsToCreate: Card[]) {
        for (let card of cardsToCreate) {
            // Card.id cannot be null, because if written already previously it has an ID,
            //   if it has been inserted it has an ID too
            if (card.id !== null && !card.inserted) {
                let id = "^" + card.id.toString() + "\n"
                card.endOffset += this.totalOffset
                let offset = card.endOffset

                this.updateFile = true
                this.file = this.file.substring(0, offset) + id + this.file.substring(offset, this.file.length + 1)
                this.totalOffset += id.length
            }
        }
    }

    private async updateCardsOnAnki(cards: Card[]): Promise<number> {
        if (cards.length) {
            this.anki.updateCards(cards).then(res => {
                this.notifications.push(`Updated successfully ${cards.length}/${cards.length} cards.`)
            }).catch(err => {
                console.error(err)
                Error("Error: Could not update cards on Anki")
            })

            return cards.length
        }
    }

    public async deleteCardsOnAnki(cards: number[], ankiBlocks: RegExpMatchArray[]): Promise<number> {
        if (cards.length) {
            let deletedCards = 0
            for (const block of ankiBlocks) {
                let id = Number(block[1])

                // Deletion of cards that need to be deleted (i.e. blocks ID that don't have content)
                if (cards.includes(id)) {
                    try {
                        this.anki.deleteCards(cards)
                        deletedCards++

                        this.updateFile = true
                        this.file = this.file.substring(0, block["index"]) + this.file.substring(block["index"] + block[0].length, this.file.length)
                        this.totalOffset -= block[0].length
                        this.notifications.push(`Deleted successfully ${deletedCards}/${cards.length} cards.`)
                    } catch (err) {
                        console.error(err)
                        Error("Error, could not delete the card from Anki")
                    }
                }
            }

            return deletedCards
        }
    }

    private getAnkiIDs(blocks: RegExpMatchArray[]): number[] {
        let IDs: number[] = []
        for (let b of blocks) {
            IDs.push(Number(b[1]))
        }

        return IDs
    }


    public filterByUpdate(ankiCards: any, generatedCards: Card[]) {
        let cardsToCreate: Card[] = []
        let cardsToUpdate: Card[] = []

        if (ankiCards) {
            for (let flashcard of generatedCards) {
                // Inserted means that anki blocks are available, that means that the card should 
                // 	(the user can always delete it) be in Anki
                let ankiCard = undefined
                if (flashcard.inserted) {
                    ankiCard = ankiCards.filter((card: any) => Number(card.noteId) === flashcard.id)[0]
                    if (!flashcard.match(ankiCard)) {
                        cardsToUpdate.push(flashcard)
                    }

                } else {
                    cardsToCreate.push(flashcard)
                }
            }
        } else {
            cardsToCreate = [...generatedCards]
        }

        return [cardsToCreate, cardsToUpdate]
    }

}