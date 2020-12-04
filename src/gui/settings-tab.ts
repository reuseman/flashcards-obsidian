import { PluginSettingTab, Setting } from "obsidian"

export class SettingsTab extends PluginSettingTab {
    display(): void {
        let { containerEl } = this
        const plugin = (this as any).plugin

        containerEl.empty()
        containerEl.createEl("h1", { text: "Flashcards" })
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
    }
}