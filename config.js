import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
    apiKey: process.env.TRELLO_API_KEY,
    token: process.env.TRELLO_TOKEN,
    sourceBoards: [
        { id: '67aca823198750b8d3e332a4', name: 'prive' },
        { id: '67acb53d60d68b99ef11344d', name: 'mba' },
        { id: '67acb47a4c0afec8a06c9870', name: 'opdracht' },
        { id: '67acabbf06e3955d1e3be739', name: 'tim-oudeboon-bv' }
    ],
    aggregateBoard: '67aca8e24e193b7fa5580831',
    listNames: ['Komende 30 dagen', 'Komende 7 dagen', 'Vandaag', 'Done'],
};