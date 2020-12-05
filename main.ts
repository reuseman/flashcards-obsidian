import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, CachedMetadata, MetadataCache, parseFrontMatterTags, parseFrontMatterStringArray, SettingTab, parseFrontMatterEntry, TFile } from 'obsidian';
import { Flashcard } from "src/entities/flashcard"
import { Settings } from 'src/settings';
import { SettingsTab } from 'src/gui/settings-tab';
import { Anki } from 'src/anki';
import { CardsService } from 'src/cards-service';


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


	onload() {
		// TODO test when file did not insert flashcards, but one of them is in Anki already
		console.log('loading flashcard-plugin');
		this.settings = new Settings()
		this.cardsService = new CardsService(this.app, this.settings)

		this.addRibbonIcon('dice', 'Sample Plugin', () => {
			new Notice('This is a notice!');
		});

		this.addStatusBarItem().setText('Status Bar Text');

		this.addCommand({
			id: 'generate-flashcard-this-file',
			name: 'Generate for this file',
			checkCallback: (checking: boolean) => {
				let activeFile = this.app.workspace.getActiveFile()
				if (activeFile) {
					if (!checking) {
						this.cardsService.execute(activeFile).then(res => {
							new Notice(res.join(" "))
						}).catch(err => {
							Error(err)
						})
					}
					return true;
				}
				return false;
			}
		});

		this.addCommand({
			id: "anki-test", name: "Anki", callback: () => {
				// let anki: Anki = new Anki()
				// anki.storeMedia(this.app.vault).then(res => {
				// 	console.log("ok")
				// 	console.log(res)
				// }).catch(err => {
				// 	console.log("err")
				// 	console.log(err)
				// })
			}
		})

		this.addSettingTab(new SettingsTab(this.app, this));

		this.registerEvent(this.app.on('codemirror', (cm: CodeMirror.Editor) => {
			//console.log('codemirror', cm);
		}));

		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			//console.log('click', evt);
		});

		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	async onunload() {
		console.log('Unloading flashcard-obsidian and saving data.');
		await this.saveData(this.settings);
	}
}
class SampleModal extends Modal {
	flashcards: Flashcard[];

	constructor(app: App, flashcards: Flashcard[]) {
		super(app);
		this.flashcards = flashcards;
	}

	onOpen() {
		let { titleEl } = this;
		let { contentEl } = this;

		titleEl.setText('Generated flashcards!');
		contentEl.setText(this.flashcards.join("\n\n"));
	}

	onClose() {
		let { contentEl } = this;
		contentEl.empty();
	}
}
