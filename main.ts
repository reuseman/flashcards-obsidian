import { Notice, Plugin } from 'obsidian';
import { ISettings } from 'src/settings';
import { SettingsTab } from 'src/gui/settings-tab';
import { CardsService } from 'src/services/cards';
import { Anki } from 'src/services/anki';
import { noticeTimeout } from 'src/constants'

export default class ObsidianFlashcard extends Plugin {
	private settings: ISettings
	private cardsService: CardsService

	async onload() {
		// TODO test when file did not insert flashcards, but one of them is in Anki already
		let anki = new Anki()
		this.settings = await this.loadData() || this.getDefaultSettings()
		this.cardsService = new CardsService(this.app, this.settings)

		let statusBar = this.addStatusBarItem()

		this.addCommand({
			id: 'generate-flashcard-current-file',
			name: 'Generate for the current file',
			checkCallback: (checking: boolean) => {
				let activeFile = this.app.workspace.getActiveFile()
				if (activeFile) {
					if (!checking) {
						this.cardsService.execute(activeFile).then(res => {
							new Notice(res.join(" "), noticeTimeout)
						}).catch(err => {
							Error(err)
						})
					}
					return true;
				}
				return false;
			}
		});

		this.addSettingTab(new SettingsTab(this.app, this));

		this.registerInterval(window.setInterval(() =>
			anki.ping().then(() => statusBar.setText('Anki ⚡️')).catch(() => statusBar.setText('')), 15 * 1000
		));
	}

	async onunload() {
		await this.saveData(this.settings);
	}

	private getDefaultSettings(): ISettings {
		return { contextAwareMode: true, contextSeparator: " > ", deck: "Default", flashcardsTag: "card" }
	}
}