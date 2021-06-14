import { Anki } from 'src/services/anki'
import { App, FileSystemAdapter, FrontMatterCache, Notice, parseFrontMatterEntry, TFile } from 'obsidian'
import { Parser } from 'src/services/parser'
import { ISettings } from 'src/settings'
import { Card } from 'src/entities/card'
import { arrayBufferToBase64 } from "src/utils"
import { Regex } from 'src/regex'
import { noticeTimeout } from 'src/constants'


export class CardsService {
    private app: App
    private settings: ISettings
    private regex: Regex
    private parser: Parser
    private anki: Anki

    private updateFile: boolean
    private totalOffset: number
    private file: string
    private notifications: string[]

    constructor(app: App, settings: ISettings) {
        this.app = app
        this.settings = settings
        this.regex = new Regex(this.settings)
        this.parser = new Parser(this.regex, this.settings)
        this.anki = new Anki()
    }

    public async execute(activeFile: TFile): Promise<string[]> {
        this.regex.update(this.settings)

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
        let filePath = activeFile.basename
        let fileCachedMetadata = this.app.metadataCache.getFileCache(activeFile)
        let vaultName = this.app.vault.getName()
        let globalTags: string[] = undefined

        // Parse frontmatter 
        let frontmatter = fileCachedMetadata.frontmatter
        let deckName = this.settings.deck
        if (frontmatter) {
            deckName = parseFrontMatterEntry(frontmatter, "cards-deck") || this.settings.deck
        }

        try {
            this.anki.storeCodeHighlightMedias()
            await this.anki.createModels(this.settings.sourceSupport, this.settings.codeHighlightSupport)
            await this.anki.createDeck(deckName)
            this.file = await this.app.vault.read(activeFile)
            if (!this.file.endsWith("\n")) {
                this.file += "\n"
            }
            globalTags = this.parseGlobalTags(this.file)
            // TODO with empty check that does not call ankiCards line
            let ankiBlocks = this.parser.getAnkiIDsBlocks(this.file)
            let ankiCards = ankiBlocks ? await this.anki.getCards(this.getAnkiIDs(ankiBlocks)) : undefined

            let cards: Card[] = this.parser.generateFlashcards(this.file, deckName, vaultName, filePath, globalTags)
            let [cardsToCreate, cardsToUpdate] = this.filterByUpdate(ankiCards, cards)
            let cardIds : number[] = this.getCardsIds(ankiCards, cards)
            let cardsToDelete: number[] = this.parser.getCardsToDelete(this.file)

            console.info("Flashcards: Cards to create")
            console.info(cardsToCreate)
            console.info("Flashcards: Cards to update")
            console.info(cardsToUpdate)
            console.info("Flashcards: Cards to delete")
            console.info(cardsToDelete)

            this.insertMedias(cards)
            await this.deleteCardsOnAnki(cardsToDelete, ankiBlocks)
            await this.updateCardsOnAnki(cardsToUpdate)
            await this.insertCardsOnAnki(cardsToCreate, frontmatter, deckName)

            // Update decks if needed
            let deckNeedToBeChanged = await this.deckNeedToBeChanged(cardIds, deckName)
            if (deckNeedToBeChanged) {
                try {
                    this.anki.changeDeck(cardIds, deckName)
                    this.notifications.push("Cards moved in new deck")
                }
                catch {
                    return ["Error: Could not update deck the file."]
                }
            }

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
            try {
                let ids = await this.anki.addCards(cardsToCreate)
                // Add IDs from response to Flashcard[]
                ids.map((id: number, index: number) => {
                    cardsToCreate[index].id = id
                })

                let total = 0
                cardsToCreate.forEach(card => {
                    if (card.id === null) {
                        new Notice(`Error, could not add: '${card.initialContent}'`, noticeTimeout)
                    } else {
                        card.reversed ? insertedCards += 2 : insertedCards++
                    }
                    card.reversed ? total += 2 : total++
                });

                this.updateFrontmatter(frontmatter, deckName)
                this.writeAnkiBlocks(cardsToCreate)

                this.notifications.push(`Inserted successfully ${insertedCards}/${total} cards.`)
                return insertedCards
            } catch (err) {
                console.error(err)
                Error("Error: Could not write cards on Anki")
            }
        }
    }

    private updateFrontmatter(frontmatter: FrontMatterCache, deckName: string) {
        let newFrontmatter: string = ""
        let cardsDeckLine: string = `cards-deck: ${deckName}\n`
        if (frontmatter) {
            let oldFrontmatter: string = this.file.substring(frontmatter.position.start.offset, frontmatter.position.end.offset)
            if (!oldFrontmatter.match(this.regex.cardsDeckLine)) {
                newFrontmatter = oldFrontmatter.substring(0, oldFrontmatter.length - 3) + cardsDeckLine + "---"
                this.totalOffset += cardsDeckLine.length
                this.file = newFrontmatter + this.file.substring(frontmatter.position.end.offset, this.file.length + 1)
            }
        } else {
            newFrontmatter = `---\n${cardsDeckLine}---\n\n`
            this.totalOffset += newFrontmatter.length
            this.file = newFrontmatter + this.file
        }
    }

    private writeAnkiBlocks(cardsToCreate: Card[]) {
        for (let card of cardsToCreate) {
            // Card.id cannot be null, because if written already previously it has an ID,
            //   if it has been inserted it has an ID too
            if (card.id !== null && !card.inserted) {
                let id = card.getIdFormat()
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
            try {
                this.anki.updateCards(cards)
                this.notifications.push(`Updated successfully ${cards.length}/${cards.length} cards.`)
            } catch (err) {
                console.error(err)
                Error("Error: Could not update cards on Anki")
            }

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
                        flashcard.oldTags = ankiCard.tags
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

    public async deckNeedToBeChanged(cardsIds : number[], deckName: string) {
        let cardsInfo = await this.anki.cardsInfo(cardsIds)
        console.log("Flashcards: Cards info")
        console.log(cardsInfo)
        if (cardsInfo.length !== 0) {
            return cardsInfo[0].deckName !== deckName
        }

        return false
    }

    public getCardsIds(ankiCards: any, generatedCards: Card[]) : number[] {
        let ids : number[] = []

         if (ankiCards) {
            for (let flashcard of generatedCards) {
                let ankiCard = undefined
                if (flashcard.inserted) {
                    ankiCard = ankiCards.filter((card: any) => Number(card.noteId) === flashcard.id)[0]
                    ids = ids.concat(ankiCard.cards)
                }
            }
        }

        return ids
    }

    public parseGlobalTags(file: String) : string[] {
        let globalTags: string[] = []

        let tags = file.match(/(?:cards-)?tags: ?(.*)/im)
        globalTags = tags ? tags[1].match(this.regex.globalTagsSplitter) : []

        if (globalTags) {
            for (let i = 0; i < globalTags.length; i++) {
                globalTags[i] = globalTags[i].replace("#", "")
                globalTags[i] = globalTags[i].replace("/", "::")
                globalTags[i] = globalTags[i].replace(/\[\[(.*)\]\]/, '$1')
                globalTags[i] = globalTags[i].trim()
                globalTags[i] = globalTags[i].replace(/ /g, "-")
            }

            return globalTags
        }

        return []
    }

}