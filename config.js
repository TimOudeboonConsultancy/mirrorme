import * as dotenv from 'dotenv';

dotenv.config();

// #region CONFIG_DEFINITION
export const config = {
    // #region API_CREDENTIALS
    apiKey: process.env.TRELLO_API_KEY,
    token: process.env.TRELLO_TOKEN,
    // #endregion API_CREDENTIALS

    // #region BOARD_DEFINITIONS
    sourceBoards: [
        { id: '67c8c911d094f51d6aca3290', name: 'prive' },
        { id: '67c8c91d0a2de30d2a066f82', name: 'mba' }
    ],
    aggregateBoard: '67c8c92aa2d17ef85ef80ebb',
    // #endregion BOARD_DEFINITIONS

    // #region LIST_CONFIGURATION
    listNames: ['Inbox', 'Komende 30 dagen', 'Komende 7 dagen', 'Vandaag', 'Done'],
    boardMapping: {
        'prive': 'green_light',
        'mba': 'blue_dark'
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