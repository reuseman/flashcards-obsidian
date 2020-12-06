import { Notice, Plugin } from 'obsidian';
import { Settings } from 'src/settings';
import { SettingsTab } from 'src/gui/settings-tab';
import { CardsService } from 'src/services/cards';
import { Anki } from 'src/services/anki';
import { noticeTimeout } from 'src/constants'

export default class ObsidianFlashcard extends Plugin {
	private settings: Settings
	private cardsService: CardsService

	// EXTRA
	// this gives you back the app:// of a resource
	// this.app.vault.adapter.getResourcePath("name")

	// IMAGES inside the file
	// let temp = this.app.metadataCache.getFileCache(this.app.workspace.getActiveFile()).embeds[2].link
	// 
	// this.app.vault.getAbstractFileByPath("resources/"+temp)

	// Path
	// this.app.vault.adapter.getBasePath()
	// this.app.vault.adapter.getFullPath(attachmentFolder + attachment)
	// this.app.vault.config.attachmentFolderPath     in my case that ś reso


	async onload() {
		// TODO test when file did not insert flashcards, but one of them is in Anki already
		let anki = new Anki()
		this.settings = await this.loadData() || new Settings()
		this.cardsService = new CardsService(this.app, this.settings)

		// this.addRibbonIcon('dice', 'Sample Plugin', () => {
		// 	new Notice('This is a notice!');
		// });

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

		// this.registerEvent(this.app.on('codemirror', (cm: CodeMirror.Editor) => {
		// 	//console.log('codemirror', cm);
		// }));

		// this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		// 	//console.log('click', evt);
		// });

		this.registerInterval(window.setInterval(() =>
			anki.ping().then(() => statusBar.setText('Anki ⚡️')).catch(() => statusBar.setText('')), 15 * 1000
		));
	}

	async onunload() {
		await this.saveData(this.settings);
	}
}