import fetch from 'node-fetch';
import { config } from './config.js';

// #region RATE_LIMITER
class RateLimiter {
    constructor(maxRequests = 100, timeWindow = 10000) {
        this.requests = [];
        this.maxRequests = maxRequests;
        this.timeWindow = timeWindow;
    }

    async acquireToken() {
        const now = Date.now();
        this.requests = this.requests.filter(time => now - time < this.timeWindow);

        if (this.requests.length >= this.maxRequests) {
            const oldestRequest = this.requests[0];
            const waitTime = this.timeWindow - (now - oldestRequest);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        this.requests.push(now);
    }
}

const rateLimiter = new RateLimiter();
// #endregion RATE_LIMITER

// #region TRELLO_API_DEFINITION
export const trelloApi = {
    baseUrl: 'https://api.trello.com/1',

    // #region REQUEST_HANDLER
    async request(endpoint, options = {}) {
        await rateLimiter.acquireToken();

        const url = `${this.baseUrl}${endpoint}?key=${config.apiKey}&token=${config.token}`;
        console.log('Making Trello API request:', {
            url: url.replace(config.token, '[REDACTED]'),
            method: options.method || 'GET',
            endpoint
        });

        try {
            const response = await fetch(url, options);

            // Parse rate limit headers
            const remaining = response.headers.get('x-rate-limit-remaining');
            const reset = response.headers.get('x-rate-limit-reset');

            if (remaining) {
                console.log(`Rate limit remaining: ${remaining}, reset: ${reset}`);
            }

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
    // #endregion REQUEST_HANDLER

    // #region BOARD_OPERATIONS
    async getBoard(boardId) {
        return this.request(`/boards/${boardId}`);
    },

    async getLists(boardId) {
        return this.request(`/boards/${boardId}/lists`);
    },

    async getCards(boardId) {
        return this.request(`/boards/${boardId}/cards`);
    },
    // #endregion BOARD_OPERATIONS

    // #region CARD_OPERATIONS
    async createCard(listId, cardData) {
        console.log('Creating card with data:', JSON.stringify(cardData, null, 2));
        console.log('List ID:', listId);
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
    },
    // #endregion CARD_OPERATIONS

    // #region LABEL_OPERATIONS
    async createLabel(boardId, labelData) {
        return this.request(`/boards/${boardId}/labels`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(labelData)
        });
    },

    async getLabels(boardId) {
        return this.request(`/boards/${boardId}/labels`);
    }
    // #endregion LABEL_OPERATIONS
};
// #endregion TRELLO_API_DEFINITION