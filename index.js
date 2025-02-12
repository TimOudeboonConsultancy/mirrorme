import express from 'express';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());

// Configuration
const config = {
    apiKey: process.env.TRELLO_API_KEY,
    token: process.env.TRELLO_TOKEN,
    sourceBoards: [
        // Add your board IDs here
        { id: 'Xsn7ppgt', name: 'prive' },
        { id: 'lBEn5ykB', name: 'mba' },
        { id: 'JAv9asAs', name: 'opdracht' },
        { id: 'NFrnAHBu', name: 'tim-oudeboon-bv' }
    ],
    aggregateBoard: '', // Add your aggregate board ID here
    listNames: ['Komende 30 dagen', 'Komende 7 dagen', 'Vandaag', 'Done'],
};

// Trello API helper functions
const trelloApi = {
    baseUrl: 'https://api.trello.com/1',

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}?key=${config.apiKey}&token=${config.token}`;
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`Trello API error: ${response.statusText}`);
        }
        return response.json();
    },

    async getBoard(boardId) {
        return this.request(`/boards/${boardId}`);
    },

    async getLists(boardId) {
        return this.request(`/boards/${boardId}/lists`);
    },

    async getCards(boardId) {
        return this.request(`/boards/${boardId}/cards`);
    },

    async createCard(listId, cardData) {
        return this.request(`/cards`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                idList: listId,
                name: cardData.name,
                desc: cardData.desc,
                due: cardData.due,
                ...cardData
            })
        });
    },

    async updateCard(cardId, updates) {
        return this.request(`/cards/${cardId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
    },

    async deleteCard(cardId) {
        return this.request(`/cards/${cardId}`, {
            method: 'DELETE'
        });
    }
};

// Card synchronization logic
class TrelloSync {
    constructor() {
        this.listMapping = new Map();
        this.cardMapping = new Map();
    }

    async initialize() {
        // Get all lists from source boards and aggregate board
        for (const board of config.sourceBoards) {
            const lists = await trelloApi.getLists(board.id);
            for (const list of lists) {
                if (config.listNames.includes(list.name)) {
                    this.listMapping.set(`${board.id}-${list.name}`, list.id);
                }
            }
        }

        const aggregateLists = await trelloApi.getLists(config.aggregateBoard);
        for (const list of aggregateLists) {
            if (config.listNames.includes(list.name)) {
                this.listMapping.set(`aggregate-${list.name}`, list.id);
            }
        }
    }

    async handleCardMove(card, sourceBoard, targetList) {
        const cardMappingKey = `${sourceBoard.id}-${card.id}`;
        let mirroredCardId = this.cardMapping.get(cardMappingKey);

        if (!mirroredCardId && config.listNames.includes(targetList.name)) {
            // Create new mirrored card
            const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);
            const mirroredCard = await trelloApi.createCard(aggregateListId, {
                ...card,
                desc: `Original board: ${sourceBoard.name}\n\n${card.desc}`,
            });
            mirroredCardId = mirroredCard.id;
            this.cardMapping.set(cardMappingKey, mirroredCardId);
        } else if (mirroredCardId) {
            if (config.listNames.includes(targetList.name)) {
                // Update existing mirrored card
                const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);
                await trelloApi.updateCard(mirroredCardId, {
                    idList: aggregateListId,
                });
            } else {
                // Remove mirrored card if moved to non-tracked list
                await trelloApi.deleteCard(mirroredCardId);
                this.cardMapping.delete(cardMappingKey);
            }
        }
    }

    async handleAggregateCardMove(card, targetList) {
        // Extract original board info from card description
        const boardMatch = card.desc.match(/Original board: (.*?)$/m);
        if (!boardMatch) return;

        const sourceBoard = config.sourceBoards.find(b => b.name === boardMatch[1]);
        if (!sourceBoard) return;

        // Find original card ID from mapping
        const originalCardId = Array.from(this.cardMapping.entries())
            .find(([_, mirroredId]) => mirroredId === card.id)?.[0]
            .split('-')[1];

        if (originalCardId) {
            const sourceListId = this.listMapping.get(`${sourceBoard.id}-${targetList.name}`);
            await trelloApi.updateCard(originalCardId, {
                idList: sourceListId,
            });
        }
    }
}

// Express routes for webhook handlers
const sync = new TrelloSync();

app.post('/webhook/card-moved', async (req, res) => {
    try {
        const { card, board, targetList } = req.body;

        if (board.id === config.aggregateBoard) {
            await sync.handleAggregateCardMove(card, targetList);
        } else {
            const sourceBoard = config.sourceBoards.find(b => b.id === board.id);
            if (sourceBoard) {
                await sync.handleCardMove(card, sourceBoard, targetList);
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('Error handling webhook:', error);
        res.sendStatus(500);
    }
});

// Initialize sync on startup
sync.initialize().catch(console.error);

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Trello sync service running on port ${port}`);
});