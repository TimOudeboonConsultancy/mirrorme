import fetch from 'node-fetch';
import * as dotenv from 'dotenv';

dotenv.config();

// Configuration (copied from index.js)
const config = {
    apiKey: process.env.TRELLO_API_KEY,
    token: process.env.TRELLO_TOKEN,
    sourceBoards: [
        { id: '67aca823198750b8d3e332a4', name: 'prive' },
        { id: '67acb53d60d68b99ef11344d', name: 'mba' },
        { id: '67acb47a4c0afec8a06c9870', name: 'opdracht' },
        { id: '67acabbf06e3955d1e3be739', name: 'tim-oudeboon-bv' }
    ],
    aggregateBoard: '67aca8e24e193b7fa5580831',
};

// Trello API helper (exactly as in index.js)
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

async function clearProjectBoards() {
    const boardsToClean = [
        { id: '67aca823198750b8d3e332a4', name: 'prive' },
        { id: '67acb53d60d68b99ef11344d', name: 'mba' },
        { id: '67acb47a4c0afec8a06c9870', name: 'opdracht' },
        { id: '67acabbf06e3955d1e3be739', name: 'tim-oudeboon-bv' },
        { id: '67aca8e24e193b7fa5580831', name: 'Verzamelbord' }
    ];

    console.log('Starting project board card cleanup...');

    for (const board of boardsToClean) {
        try {
            console.log(`Clearing cards from board: ${board.name} (${board.id})`);
            const lists = await trelloApi.request(`/boards/${board.id}/lists`);

            for (const list of lists) {
                const cards = await trelloApi.request(`/lists/${list.id}/cards`);
                console.log(`List "${list.name}" has ${cards.length} cards`);

                for (const card of cards) {
                    console.log(`Deleting card: ${card.name} (${card.id})`);
                    await trelloApi.deleteCard(card.id);
                }
            }
        } catch (error) {
            console.error(`Error clearing board ${board.name}:`, error);
        }
    }

    console.log('Project board card cleanup complete!');
}

// Immediately invoke the cleanup function
clearProjectBoards().catch(console.error);