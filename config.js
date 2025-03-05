import * as dotenv from 'dotenv';

dotenv.config();

// #region CONFIG_DEFINITION
export const config = {
    // #region API_CREDENTIALS
    apiKey: process.env.TRELLO_API_KEY,
    token: process.env.TRELLO_TOKEN,
    // #endregion API_CREDENTIALS

    // #region BOARD_DEFINITIONS (production)
    sourceBoards: [
        { id: '67aca823198750b8d3e332a4', name: 'prive' },
        { id: '67acb53d60d68b99ef11344d', name: 'mba' },
        { id: '67acb47a4c0afec8a06c9870', name: 'opdracht' },
        { id: '67acabbf06e3955d1e3be739', name: 'tim-oudeboon-bv' }
    ],
    aggregateBoard: '67aca8e24e193b7fa5580831',
    // #endregion BOARD_DEFINITIONS

    // #region LIST_CONFIGURATION
    listNames: ['Inbox', 'Komende 30 dagen', 'Komende 7 dagen', 'Vandaag', 'Done'],
    boardMapping: {
        'prive': 'green_light',
        'mba': 'blue_dark',
        'opdracht': 'red_light',
        'tim-oudeboon-bv': 'orange_dark'
    },
    // #endregion LIST_CONFIGURATION

    // #region DATE_AND_PRIORITY
    timezone: 'Europe/Amsterdam',
    listPriorities: [
        { name: 'Vandaag', maxDays: 0 },
        { name: 'Komende 7 dagen', maxDays: 7 },
        { name: 'Komende 30 dagen', maxDays: 30 }
    ]
    // #endregion DATE_AND_PRIORITY
};
// #endregion CONFIG_DEFINITION