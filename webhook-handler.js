import crypto from 'crypto';
import { config } from './config.js';

export function validateTrelloWebhook(req, res, next) {
    // [Existing webhook validation logic from index.js]
    // The implementation remains largely the same
}

export function createWebhookRoutes(app, trelloSync) {
    app.get('/', (req, res) => {
        res.send('Trello Sync Service is running!');
    });

    app.all('/webhook/card-moved', validateTrelloWebhook, (req, res) => {
        console.log(`Webhook request received: ${req.method}`);
        console.log('Webhook headers:', JSON.stringify(req.headers, null, 2));
        console.log('Webhook body:', JSON.stringify(req.body, null, 2));

        // [Rest of the existing webhook handling logic]
        // This would include the logic to handle card movements
    });
}