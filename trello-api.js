import fetch from 'node-fetch';
import { config } from './config.js';

export const trelloApi = {
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