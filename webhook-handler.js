import crypto from 'crypto';
import { config } from './config.js';
import { setTimeout } from 'timers/promises';
import { trelloApi } from './trello-api.js';

// Timeout utility function
async function withTimeout(asyncFunc, ms = 10000, errorMessage = 'Operation timed out') {
    return Promise.race([
        asyncFunc,
        new Promise((_, reject) =>
            setTimeout(ms).then(() => reject(new Error(errorMessage)))
        )
    ]);
}

export function validateTrelloWebhook(req, res, next) {
    // Allow HEAD requests without validation
    if (req.method === 'HEAD' || req.method === 'OPTIONS') {
        return next();
    }

    // Only validate POST requests with HMAC
    if (req.method === 'POST') {
        const callbackURL = 'https://trello-sync-mirror-f28465526010.herokuapp.com/webhook/card-moved';

        try {
            // Extensive logging for debugging
            console.log('Webhook Validation Detailed Debug:');
            console.log('Request Method:', req.method);
            console.log('Raw Body Length:', req.rawBody ? req.rawBody.length : 'NO RAW BODY');
            console.log('Callback URL:', callbackURL);
            console.log('All Headers:', JSON.stringify(req.headers, null, 2));
            console.log('X-Trello-Webhook Header:', req.headers['x-trello-webhook']);
            console.log('API Secret Present:', !!process.env.TRELLO_API_SECRET);

            // First, verify the presence of the webhook signature
            const trelloSignature = req.headers['x-trello-webhook'];
            if (!trelloSignature) {
                console.error('No Trello webhook signature found');
                return res.status(401).send('Unauthorized: Missing webhook signature');
            }

            // Verify the API secret is present
            if (!process.env.TRELLO_API_SECRET) {
                console.error('Trello API Secret is not set');
                return res.status(500).send('Internal Server Error: Missing API Secret');
            }

            // Validate the body is not empty
            if (!req.rawBody) {
                console.error('Raw body is empty');
                return res.status(400).send('Bad Request: Empty body');
            }

            // Compute HMAC signature
            const hmac = crypto.createHmac('sha1', process.env.TRELLO_API_SECRET);
            const computedSignature = hmac
                .update(req.rawBody + callbackURL)
                .digest('base64');

            console.log('Received Signature:', trelloSignature);
            console.log('Computed Signature:', computedSignature);

            // Validate the signature
            if (computedSignature === trelloSignature) {
                return next();
            } else {
                console.error('Webhook signature validation failed');
                console.error('Signature Mismatch:');
                console.error('Received:', trelloSignature);
                console.error('Computed:', computedSignature);
                return res.status(401).send('Unauthorized: Invalid webhook signature');
            }
        } catch (error) {
            console.error('Webhook validation error:', error);
            return res.status(500).send('Internal Server Error');
        }
    }

    // Allow GET requests for health checks
    if (req.method === 'GET') {
        return next();
    }

    // Deny other methods
    res.status(405).send('Method Not Allowed');
}

export function createWebhookRoutes(app, trelloSync) {
    app.get('/', (req, res) => {
        res.send('Trello Sync Service is running!');
    });

    app.all('/webhook/card-moved', validateTrelloWebhook, async (req, res) => {
        // Immediately respond to the webhook
        res.sendStatus(200);

        try {
            console.log('\n=== New Webhook Event ===');
            console.log('Timestamp:', new Date().toISOString());

            if (!req.body.action) {
                console.log('No action in webhook payload');
                return;
            }

            const { action } = req.body;

            // Enhanced logging for all incoming webhook data
            console.log('\n=== Webhook Action Details ===');
            console.log('Action Type:', action.type);
            console.log('Action ID:', action.id);
            console.log('Board Info:', {
                id: action.data.board?.id,
                name: action.data.board?.name,
                isSourceBoard: config.sourceBoards.some(b => b.id === action.data.board?.id),
                isAggregateBoard: action.data.board?.id === config.aggregateBoard
            });
            console.log('Card Info:', {
                id: action.data.card?.id,
                name: action.data.card?.name,
                shortLink: action.data.card?.shortLink
            });
            console.log('List Info:', {
                current: action.data.list,
                after: action.data.listAfter,
                before: action.data.listBefore
            });
            console.log('Member Creator:', {
                id: action.memberCreator?.id,
                username: action.memberCreator?.username
            });

            // Log the current state of trelloSync
            console.log('\n=== TrelloSync State ===');
            console.log('List Mappings:', Array.from(trelloSync.listMapping.entries()));
            console.log('Card Mappings:', Array.from(trelloSync.cardMapping.entries()));

            // Handle both createCard and updateCard events
            if ((action.type === 'createCard' ||
                    action.type === 'updateCard' ||
                    action.type === 'addLabelToCard') &&
                action.data && action.data.board) {

                console.log('\n=== Processing Card Action ===');

                const card = action.data.card;
                const board = action.data.board;
                let targetList;

                // Enhanced list determination logic
                if (action.type === 'addLabelToCard') {
                    console.log('Fetching full card details for label action...');
                    const fullCard = await trelloApi.request(`/cards/${card.id}`);
                    console.log('Full card details:', fullCard);
                    const fullList = await trelloApi.request(`/lists/${fullCard.idList}`);
                    console.log('Full list details:', fullList);
                    targetList = fullList;
                } else {
                    targetList = action.data.listAfter || action.data.list;
                }

                if (!targetList) {
                    console.log('No target list found in webhook data');
                    return;
                }

                console.log('Final target list determination:', {
                    id: targetList.id,
                    name: targetList.name,
                    isConfiguredList: config.listNames.includes(targetList.name)
                });

                // Handle card operations with enhanced logging
                if (board.id === config.aggregateBoard) {
                    console.log('\n=== Processing Aggregate Board Action ===');
                    await withTimeout(
                        () => trelloSync.handleAggregateCardMove(card, targetList),
                        15000,
                        `Timeout in handleAggregateCardMove for card ${card.id}`
                    );
                } else {
                    const sourceBoard = config.sourceBoards.find(b => b.id === board.id);
                    if (sourceBoard) {
                        console.log('\n=== Processing Source Board Action ===');
                        console.log('Source Board:', sourceBoard);

                        if (config.listNames.includes(targetList.name)) {
                            console.log('List is configured, handling card move...');
                            await withTimeout(
                                () => trelloSync.handleCardMove(card, sourceBoard, targetList),
                                15000,
                                `Timeout in handleCardMove for card ${card.id}`
                            );
                        } else {
                            console.log(`List "${targetList.name}" not in configured lists:`, config.listNames);
                        }
                    } else {
                        console.log(`Board ${board.id} not found in source boards:`,
                            config.sourceBoards.map(b => ({ id: b.id, name: b.name })));
                    }
                }
            } else {
                console.log('Action type not handled:', action.type);
            }
        } catch (error) {
            console.error('\n=== Webhook Processing Error ===');
            console.error('Error:', error);
            if (error.message.includes('Timeout')) {
                console.error('Operation timed out:', error.message);
            }
            // Log the full error stack for debugging
            console.error('Stack:', error.stack);
        }
    });
}