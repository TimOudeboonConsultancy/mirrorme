// In webhook-setup.js
// Update the callbackURL with your new Heroku URL:

const config = {
    apiKey: process.env.TRELLO_API_KEY,
    token: process.env.TRELLO_TOKEN,
    secret: process.env.TRELLO_API_SECRET,
    shortBoardIds: [
        '9AMS4GJO', // dev-prive
        'x6QQfoXY', // dev-mba
        'r3GkCgoe'  // dev-verzamelbord
    ],
    callbackURL: 'https://trello-sync-dev-fa9d25536258.herokuapp.com/webhook/card-moved'
};