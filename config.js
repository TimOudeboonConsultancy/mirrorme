import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
    apiKey: process.env.TRELLO_API_KEY,
    token: process.env.TRELLO_TOKEN,
    sourceBoards: [
        { id: '67aca823198750b8d3e332a4', name: 'Prive' },
        { id: '67acb53d60d68b99ef11344d', name: 'MBA' },
        { id: '67acb47a4c0afec8a06c9870', name: 'Opdracht' },
        { id: '67acabbf06e3955d1e3be739', name: 'Tim Oudeboon B.V.' }
    ],
    aggregateBoard: '67aca8e24e193b7fa5580831',
    listNames: ['Komende 30 dagen', 'Komende 7 dagen', 'Vandaag', 'Done'],
    boardMapping: {
        'Prive': 'green_light',
        'MBA': 'blue_dark',
        'Opdracht': 'red_light',
        'Tim Oudeboon B.V.': 'orange_dark'
    }
};