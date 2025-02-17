import fetch from 'node-fetch';
import { config } from './config.js';

export const trelloApi = {
    baseUrl: 'https://api.trello.com/1',

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}?key=${config.apiKey}&token=${config.token}`;
        console.log('Making Trello API request:', {
            url: url.replace(config.token, '[REDACTED]'),
            method: options.method || 'GET',
            endpoint
        });

        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Trello API error response:', {
                    status: response.status,
                    statusText: response.statusText,
                    errorText
                });
                const error = new Error(`Trello API error: ${response.statusText}`);
                error.response = errorText;
                error.status = response.status;
                throw error;
            }
            return response.json();
        } catch (error) {
            console.error('Trello API request failed:', {
                error: error.message,
                endpoint,
                method: options.method || 'GET'
            });
            throw error;
        }
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
        console.log('Creating card with data:', JSON.stringify(cardData, null, 2));
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
        console.log('Updating card with data:', JSON.stringify(updates, null, 2));
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