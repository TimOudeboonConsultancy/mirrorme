// improved-webhook-cleanup.js
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';

dotenv.config();

const config = {
    apiKey: process.env.TRELLO_API_KEY,
    token: process.env.TRELLO_TOKEN,
    callbackURL: 'https://trello-sync-dev-fa9d25536258.herokuapp.com/webhook/card-moved',
    sourceBoards: [
        '67aca823198750b8d3e332a4', // prive
        '67acb53d60d68b99ef11344d', // mba
        '67acb47a4c0afec8a06c9870', // opdracht
        '67acabbf06e3955d1e3be739', // tim-oudeboon-bv
        '67aca8e24e193b7fa5580831'  // aggregate board
    ]
};

async function listWebhooks() {
    const url = `https://api.trello.com/1/tokens/${config.token}/webhooks?key=${config.apiKey}&token=${config.token}`;
    
    try {
        const response = await fetch(url);
        return await response.json();
    } catch (error) {
        console.error('Error listing webhooks:', error);
        return [];
    }
}

async function deleteWebhook(webhookId) {
    const url = `https://api.trello.com/1/webhooks/${webhookId}?key=${config.apiKey}&token=${config.token}`;
    
    try {
        const response = await fetch(url, { method: 'DELETE' });
        
        if (response.ok) {
            console.log(`Successfully deleted webhook ${webhookId}`);
            return true;
        } else {
            console.error(`Failed to delete webhook ${webhookId}`);
            return false;
        }
    } catch (error) {
        console.error(`Error deleting webhook ${webhookId}:`, error);
        return false;
    }
}

async function createWebhook(boardId) {
    const url = `https://api.trello.com/1/webhooks?key=${config.apiKey}&token=${config.token}`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                description: `Card movement webhook for board ${boardId}`,
                callbackURL: config.callbackURL,
                idModel: boardId
            })
        });

        const responseText = await response.text();
        console.log(`Webhook creation for board ${boardId} response:`, responseText);

        return response.ok;
    } catch (error) {
        console.error(`Error creating webhook for board ${boardId}:`, error);
        return false;
    }
}

async function cleanupWebhooks() {
    console.log('Starting webhook cleanup...');
    
    // List all current webhooks
    const allWebhooks = await listWebhooks();
    console.log('Total existing webhooks:', allWebhooks.length);

    // Delete ALL existing webhooks
    for (const webhook of allWebhooks) {
        await deleteWebhook(webhook.id);
    }

    // Create new webhooks for each board
    console.log('Creating new webhooks...');
    let successCount = 0;
    for (const boardId of config.sourceBoards) {
        const success = await createWebhook(boardId);
        if (success) successCount++;
    }

    console.log(`Webhook setup complete! Successfully created ${successCount} out of ${config.sourceBoards.length} webhooks.`);
}

cleanupWebhooks().catch(console.error);