# AI Sorter

Automatically sort your Obsidian notes into folders using AI.

## Features

- **Multi-AI Support**: Choose between Google Gemini, Anthropic Claude, or OpenAI GPT
- **Smart Folder Detection**: Auto-detect existing folders or use custom lists
- **Batch Processing**: Sort multiple notes efficiently with configurable concurrent requests
- **Safe Operation**: Confirmation dialog before moving files

## Setup

1. Install the plugin
2. Go to Settings → AI Sorter
3. Choose your AI model and add your API key
4. Configure source and target folders
5. Click the brain icon in the ribbon or use the command palette

## Usage

The plugin analyzes note content and moves files to the most appropriate folder based on their content.

**Command**: "Sort notes with AI"  
**Ribbon Icon**: Brain circuit icon

## Settings

- **AI Model**: Choose Gemini, Claude, or GPT
- **API Keys**: Set your chosen AI service API key
- **Source Folder**: Where to sort from (empty = root folder)
- **Target Folders**: Auto-detect or specify custom folders
- **Performance**: Adjust concurrent API requests

## API Keys

Get your API key from:
- [Google AI Studio](https://aistudio.google.com/) (Gemini)
- [Anthropic Console](https://console.anthropic.com/) (Claude)  
- [OpenAI Platform](https://platform.openai.com/) (GPT)