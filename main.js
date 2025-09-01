const { App, Plugin, PluginSettingTab, Setting, TFile, Notice, Modal, ButtonComponent, TFolder } = require('obsidian');

const DEFAULT_SETTINGS = {
	aiModel: 'gemini',
	geminiApiKey: '',
	claudeApiKey: '',
	gptApiKey: '',
	sourceFolder: '',
	useAutoDetection: true,
	targetFolders: ['Algorithmique', 'Automatique', 'Maths', 'TP', 'Electronique'],
	maxWorkers: 10
};

class AISorterPlugin extends Plugin {
	async onload() {
		await this.loadSettings();

		// Add ribbon icon
		this.addRibbonIcon('brain-circuit', 'AI Sort Notes', () => {
			this.sortNotes();
		});

		// Add command
		this.addCommand({
			id: 'sort-notes-ai',
			name: 'Sort notes with AI',
			callback: () => {
				this.sortNotes();
			}
		});

		// Add settings tab
		this.addSettingTab(new AISorterSettingTab(this.app, this));
	}

	onunload() {
		// Clean up
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async sortNotes() {
		const currentApiKey = this.getCurrentApiKey();
		if (!currentApiKey) {
			new Notice(`Please set your ${this.settings.aiModel.toUpperCase()} API key in settings first.`);
			return;
		}

		// Auto-detect folders if enabled
		if (this.settings.useAutoDetection) {
			this.autoDetectTargetFolders();
		}

		// Show confirmation modal
		new SortConfirmationModal(this.app, this).open();
	}

	getCurrentApiKey() {
		switch (this.settings.aiModel) {
			case 'gemini':
				return this.settings.geminiApiKey;
			case 'claude':
				return this.settings.claudeApiKey;
			case 'gpt':
				return this.settings.gptApiKey;
			default:
				return '';
		}
	}

	autoDetectTargetFolders() {
		this.settings.targetFolders = this.app.vault.getAllLoadedFiles()
			.filter(f => f instanceof TFolder && !f.path.includes('/'))
			.map(f => f.name);
	}

	async performSort() {
		const sourceFolder = this.settings.sourceFolder || '';
		const files = this.app.vault.getMarkdownFiles().filter(file => {
			if (sourceFolder === '') {
				// Root folder - files not in any subfolder
				return !file.path.includes('/');
			} else {
				// Specific folder
				return file.path.startsWith(sourceFolder + '/') || file.path === sourceFolder;
			}
		});

		if (files.length === 0) {
			new Notice('No notes found in the specified source folder.');
			return;
		}

		new Notice(`Starting AI sorting of ${files.length} notes using ${this.settings.aiModel.toUpperCase()}...`);

		// Process files in batches to avoid overwhelming the API
		const batchSize = this.settings.maxWorkers;
		const batches = [];
		for (let i = 0; i < files.length; i += batchSize) {
			batches.push(files.slice(i, i + batchSize));
		}

		let totalMoved = 0;
		let totalErrors = 0;

		for (const batch of batches) {
			const promises = batch.map(file => this.classifyAndMoveNote(file));
			const results = await Promise.allSettled(promises);
			
			results.forEach((result, index) => {
				if (result.status === 'fulfilled' && result.value) {
					totalMoved++;
				} else {
					totalErrors++;
					console.error('Error processing note:', batch[index].name, result.status === 'rejected' ? result.reason : 'Classification failed');
				}
			});

			// Small delay between batches to be respectful to the API
			if (batches.indexOf(batch) < batches.length - 1) {
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
		}

		new Notice(`AI sorting complete! Moved: ${totalMoved}, Errors: ${totalErrors}`);
	}

	async classifyAndMoveNote(file) {
		try {
			const content = await this.app.vault.read(file);
			
			if (!content.trim()) {
				return false;
			}

			const chosenFolder = await this.classifyNote(content);
			
			if (chosenFolder && this.settings.targetFolders.includes(chosenFolder)) {
				// Ensure target folder exists
				const targetFolderPath = chosenFolder;
				const targetFolder = this.app.vault.getAbstractFileByPath(targetFolderPath);
				
				if (!targetFolder) {
					await this.app.vault.createFolder(targetFolderPath);
				}

				// Move the file
				const newPath = `${targetFolderPath}/${file.name}`;
				await this.app.vault.rename(file, newPath);
				return true;
			} else {
				return false;
			}
		} catch (error) {
			console.error(`Error processing ${file.name}:`, error);
			return false;
		}
	}

	async classifyNote(content) {
		try {
			const prompt = `Analyze the following note content and determine the best folder for it from this list: ${this.settings.targetFolders.join(', ')}. Respond with only the single, most appropriate folder name from the list and nothing else.

Note Content:
---
${content.substring(0, 4000)}`;

			let response = null;

			switch (this.settings.aiModel) {
				case 'gemini':
					response = await this.callGeminiAPI(prompt);
					break;
				case 'claude':
					response = await this.callClaudeAPI(prompt);
					break;
				case 'gpt':
					response = await this.callGPTAPI(prompt);
					break;
			}

			return response?.trim() || null;
		} catch (error) {
			console.error('AI API call failed:', error);
			return null;
		}
	}

	async callGeminiAPI(prompt) {
		try {
			const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=' + this.settings.geminiApiKey, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					contents: [{
						parts: [{
							text: prompt
						}]
					}]
				})
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.json();
			return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
		} catch (error) {
			console.error('Gemini API error:', error);
			throw error;
		}
	}

	async callClaudeAPI(prompt) {
		try {
			const response = await fetch('https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': this.settings.claudeApiKey,
					'anthropic-version': '2023-06-01'
				},
				body: JSON.stringify({
					model: 'claude-3-haiku-20240307',
					max_tokens: 100,
					messages: [{
						role: 'user',
						content: prompt
					}]
				})
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.json();
			return data.content?.[0]?.text || null;
		} catch (error) {
			console.error('Claude API error:', error);
			throw error;
		}
	}

	async callGPTAPI(prompt) {
		try {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.settings.gptApiKey}`
				},
				body: JSON.stringify({
					model: 'gpt-3.5-turbo',
					messages: [{
						role: 'user',
						content: prompt
					}],
					max_tokens: 100,
					temperature: 0.1
				})
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.json();
			return data.choices?.[0]?.message?.content || null;
		} catch (error) {
			console.error('GPT API error:', error);
			throw error;
		}
	}
}

class SortConfirmationModal extends Modal {
	constructor(app, plugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'AI Sort Confirmation' });
		
		const sourceFolder = this.plugin.settings.sourceFolder || 'root folder';
		const aiModel = this.plugin.settings.aiModel.toUpperCase();
		const detectionMode = this.plugin.settings.useAutoDetection ? 'Auto-detected' : 'Custom';
		
		contentEl.createEl('p', { 
			text: `This will sort all markdown files in "${sourceFolder}" using ${aiModel} into the following folders:` 
		});
		
		contentEl.createEl('p', { 
			text: `Folder detection: ${detectionMode}`,
			cls: 'setting-item-description'
		});
		
		const folderList = contentEl.createEl('ul');
		this.plugin.settings.targetFolders.forEach(folder => {
			folderList.createEl('li', { text: folder });
		});
		
		contentEl.createEl('p', { 
			text: 'Files will be moved permanently. Make sure you have a backup if needed.' 
		});

		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
		
		new ButtonComponent(buttonContainer)
			.setButtonText('Cancel')
			.onClick(() => {
				this.close();
			});

		new ButtonComponent(buttonContainer)
			.setButtonText('Sort Notes')
			.setCta()
			.onClick(async () => {
				this.close();
				await this.plugin.performSort();
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class AISorterSettingTab extends PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'AI Sorter Settings' });

		// AI Model Selection
		new Setting(containerEl)
			.setName('AI Model')
			.setDesc('Choose which AI model to use for classification')
			.addDropdown(dropdown => dropdown
				.addOptions({
					'gemini': 'Google Gemini',
					'claude': 'Anthropic Claude',
					'gpt': 'OpenAI GPT'
				})
				.setValue(this.plugin.settings.aiModel)
				.onChange(async (value) => {
					this.plugin.settings.aiModel = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show relevant API key field
				}));

		// API Keys
		new Setting(containerEl).setName('API Keys').setHeading();

		if (this.plugin.settings.aiModel === 'gemini') {
			new Setting(containerEl)
				.setName('Gemini API Key')
				.setDesc('Enter your Google Gemini API key')
				.addText(text => text
					.setPlaceholder('Enter your Gemini API key')
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value;
						await this.plugin.saveSettings();
					}));
		}

		if (this.plugin.settings.aiModel === 'claude') {
			new Setting(containerEl)
				.setName('Claude API Key')
				.setDesc('Enter your Anthropic Claude API key')
				.addText(text => text
					.setPlaceholder('Enter your Claude API key')
					.setValue(this.plugin.settings.claudeApiKey)
					.onChange(async (value) => {
						this.plugin.settings.claudeApiKey = value;
						await this.plugin.saveSettings();
					}));
		}

		if (this.plugin.settings.aiModel === 'gpt') {
			new Setting(containerEl)
				.setName('OpenAI API Key')
				.setDesc('Enter your OpenAI API key')
				.addText(text => text
					.setPlaceholder('Enter your OpenAI API key')
					.setValue(this.plugin.settings.gptApiKey)
					.onChange(async (value) => {
						this.plugin.settings.gptApiKey = value;
						await this.plugin.saveSettings();
					}));
		}

		// Folder Settings
		new Setting(containerEl).setName('Folder Settings').setHeading();

		new Setting(containerEl)
			.setName('Source Folder')
			.setDesc('Folder to sort notes from (leave empty for root folder)')
			.addText(text => text
				.setPlaceholder('e.g. "Unsorted" or leave empty for root')
				.setValue(this.plugin.settings.sourceFolder)
				.onChange(async (value) => {
					this.plugin.settings.sourceFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-detect target folders')
			.setDesc('Automatically detect folders in root directory, or use custom folder list')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useAutoDetection)
				.onChange(async (value) => {
					this.plugin.settings.useAutoDetection = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh to show/hide custom folders setting
				}));

		if (!this.plugin.settings.useAutoDetection) {
			new Setting(containerEl)
				.setName('Custom target folders')
				.setDesc('Comma-separated list of folders to sort notes into')
				.addTextArea(text => text
					.setPlaceholder('Algorithmique, Automatique, Maths, TP, Electronique')
					.setValue(this.plugin.settings.targetFolders.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.targetFolders = value
							.split(',')
							.map(folder => folder.trim())
							.filter(folder => folder.length > 0);
						await this.plugin.saveSettings();
					}));
		} else {
			// Show current auto-detected folders
			const currentFolders = containerEl.createEl('div');
			currentFolders.createEl('p', { 
				text: 'Current target folders (auto-detected):',
				cls: 'setting-item-name'
			});
			const folderList = currentFolders.createEl('ul', { cls: 'setting-item-description' });
			this.plugin.settings.targetFolders.forEach(folder => {
				folderList.createEl('li', { text: folder });
			});
		}

		// Performance
		new Setting(containerEl).setName('Performance').setHeading();

		new Setting(containerEl)
			.setName('Max concurrent requests')
			.setDesc('Maximum number of concurrent API requests (lower = slower but more reliable)')
			.addSlider(slider => slider
				.setLimits(1, 20, 1)
				.setValue(this.plugin.settings.maxWorkers)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxWorkers = value;
					await this.plugin.saveSettings();
				}));
	}
}

module.exports = AISorterPlugin;