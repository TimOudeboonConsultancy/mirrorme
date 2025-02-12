// webhook-setup.js
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const config = {
    apiKey: process.env.TRELLO_API_KEY,
    token: process.env.TRELLO_TOKEN,
    secret: process.env.TRELLO_API_SECRET,
    shortBoardIds: [
        'Xsn7ppgt', // prive
        'lBEn5ykB', // mba
        'JAv9asAs', // opdracht
        'NFrnAHBu', // tim-oudeboon-bv
        'McEG7GGu'  // aggregate board
    ],
    callbackURL: 'https://trello-sync-mirror-f28465526010.herokuapp.com/webhook/card-moved'
};

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function generateTrelloWebhookSignature(content) {
    const doubleHash = crypto
        .createHmac('sha1', config.secret)
        .update(content)
        .digest('base64');
    return doubleHash;
}

async function testWebhookEndpoint() {
    console.log('Testing webhook endpoint...');
    
    try {
        // Test HEAD request first as that's what Trello will do
        console.log('\nTesting HEAD request...');
        const headResponse = await fetch(config.callbackURL, {
            method: 'HEAD'
        });
        console.log('HEAD response status:', headResponse.status);

        if (headResponse.status !== 200) {
            throw new Error('Webhook endpoint is not responding correctly to HEAD requests');
        }

        // Test GET request
        console.log('\nTesting GET request...');
        const dummyContent = 'test-content';
        const signature = generateTrelloWebhookSignature(dummyContent + config.callbackURL);
        
        const getResponse = await fetch(config.callbackURL, {
            headers: {
                'X-Trello-Webhook': signature,
                'Content-Type': 'application/json'
            }
        });
        console.log('GET response status:', getResponse.status);
        const text = await getResponse.text();
        console.log('GET response:', text);
    } catch (error) {
        console.error('Error testing webhook endpoint:', error);
        process.exit(1);
    }
}

async function getFullBoardId(shortId) {
    const url = `https://api.trello.com/1/boards/${shortId}?key=${config.apiKey}&token=${config.token}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to get board info: ${response.statusText}`);
        }
        const board = await response.json();
        return board.id;
    } catch (error) {
        console.error(`Error getting full board ID for ${shortId}:`, error);
        return null;
    }
}

async function createWebhook(boardId) {
    const url = `https://api.trello.com/1/webhooks?key=${config.apiKey}&token=${config.token}`;
    
    try {
        console.log(`\nCreating webhook for board ${boardId}`);
        const requestBody = {
            description: `Card movement webhook for board ${boardId}`,
            callbackURL: config.callbackURL,
            idModel: boardId,
            active: true
        };
        
        console.log('Request body:', JSON.stringify(requestBody, null, 2));
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const responseText = await response.text();
        console.log(`Response status: ${response.status}`);
        console.log('Response headers:', response.headers);
        console.log('Response body:', responseText);

        if (!response.ok) {
            throw new Error(`Failed to create webhook: ${responseText}`);
        }

        console.log(`Successfully created webhook for board ${boardId}`);
        return true;
    } catch (error) {
        console.error(`Error creating webhook for board ${boardId}:`, error);
        return false;
    }
}

async function setupWebhooks() {
    // First test the webhook endpoint
    await testWebhookEndpoint();
    
    console.log('\nGetting full board IDs...');
    
    const fullBoardIds = [];
    for (const shortId of config.shortBoardIds) {
        const fullId = await getFullBoardId(shortId);
        if (fullId) {
            fullBoardIds.push(fullId);
            console.log(`Got full ID for ${shortId}: ${fullId}`);
        }
        await sleep(1000);
    }

    console.log('\nSetting up webhooks...');
    let successCount = 0;
    
    for (const boardId of fullBoardIds) {
        const success = await createWebhook(boardId);
        if (success) successCount++;
        await sleep(1000);
    }
    
    console.log(`\nWebhook setup complete! Successfully created ${successCount} out of ${fullBoardIds.length} webhooks.`);
}

// Run the setup
setupWebhooks().catch(error => {
    console.error('Setup failed:', error);
    process.exit(1);
});