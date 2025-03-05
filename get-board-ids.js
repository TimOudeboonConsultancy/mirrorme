// get-board-ids.js
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function getBoardIds() {
    const apiKey = process.env.TRELLO_API_KEY;
    const token = process.env.TRELLO_TOKEN;

    // These are the short IDs from the URLs
    const shortIds = {
        'prive': '9AMS4GJO',
        'mba': 'x6QQfoXY',
        'verzamelbord': 'r3GkCgoe'
    };

    console.log('Fetching full board IDs from Trello API...');

    for (const [name, shortId] of Object.entries(shortIds)) {
        try {
            const url = `https://api.trello.com/1/boards/${shortId}?key=${apiKey}&token=${token}`;
            const response = await fetch(url);

            if (!response.ok) {
                console.error(`Error fetching board ${name}: ${response.statusText}`);
                continue;
            }

            const board = await response.json();
            console.log(`${name}: { id: '${board.id}', name: '${name}' },`);
        } catch (error) {
            console.error(`Error fetching board ${name}:`, error);
        }
    }
}

getBoardIds().catch(console.error);