import { Notice, PluginSettingTab, Setting } from "obsidian"
import { Anki } from 'src/services/anki'

export class SettingsTab extends PluginSettingTab {
    display(): void {
        let { containerEl } = this
        const plugin = (this as any).plugin

        containerEl.empty()
        containerEl.createEl("h1", { text: "Flashcards" })

        new Setting(containerEl)
            .setName("Test Anki")
            .setDesc("Test that connection between Anki and Obsidian actually works.")
            .addButton((text) => {
                text.setButtonText("Test")
                    .onClick(() => {
                        new Anki().ping().then(() => new Notice("Anki works")).catch(() => new Notice("Anki is not connected"))
                    })
            })
        containerEl.createEl("h2", { text: "General Settings" })

        new Setting(containerEl)
            .setName("Context-aware mode")
            .setDesc("Add the ancestor headings to the question of the flashcard.")
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.contextAwareMode)
                    .onChange((value) => {
                        plugin.settings.contextAwareMode = value
                        plugin.saveData(plugin.settings)
                    })
            )


        new Setting(containerEl)
            .setName("Code highlight support")
            .setDesc("Add highlight of the code in Anki.")
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.codeHighlightSupport)
                    .onChange((value) => {
                        plugin.settings.codeHighlightSupport = value
                        plugin.saveData(plugin.settings)
                    })
            )
        new Setting(containerEl)
            .setName("Default deck")
            .setDesc("The name of the default deck where the cards will be added when not specified.")
            .addText((text) => {
                text.setValue(plugin.settings.deck)
                    .setPlaceholder("Deck::sub-deck")
                    .onChange((value) => {
                        if (value.length) {
                            plugin.settings.deck = value
                            plugin.saveData(plugin.settings)
                        } else {
                            new Notice("The deck name must be at least 1 character long")
                        }
                    })
            })

        new Setting(containerEl)
            .setName("Flashcards #tag")
            .setDesc("The tag to identify the flashcards in the notes (case-insensitive).")
            .addText((text) => {
                text.setValue(plugin.settings.flashcardsTag)
                    .setPlaceholder("Card")
                    .onChange((value) => {
                        if (value) {
                            plugin.settings.flashcardsTag = value.toLowerCase()
                            plugin.saveData(plugin.settings)
                        } else {
                            new Notice("The tag must be at least 1 character long")
                        }
                    })
            })


    }
}