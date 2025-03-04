import crypto from 'crypto';
import { config } from './config.js';
import { setTimeout } from 'timers/promises';
import { trelloApi } from './trello-api.js';

// #region WEBHOOK_PROCESSOR
class WebhookProcessor {
    constructor() {
        // Store recently processed webhook IDs with timestamps
        this.processedWebhooks = new Map();
        // Cleanup interval (5 minutes)
        setInterval(() => this.cleanupProcessedWebhooks(), 5 * 60 * 1000);
    }

    isWebhookProcessed(actionId) {
        return this.processedWebhooks.has(actionId);
    }

    markWebhookProcessed(actionId) {
        this.processedWebhooks.set(actionId, Date.now());
    }

    cleanupProcessedWebhooks() {
        const now = Date.now();
        const expiryTime = 5 * 60 * 1000; // 5 minutes

        for (const [actionId, timestamp] of this.processedWebhooks.entries()) {
            if (now - timestamp > expiryTime) {
                this.processedWebhooks.delete(actionId);
            }
        }
    }
}

const webhookProcessor = new WebhookProcessor();
// #endregion WEBHOOK_PROCESSOR

// #region TIMEOUT_UTILITY
// Enhanced timeout utility with logging
async function withTimeout(asyncFunc, ms = 10000, operationName = 'Unknown Operation') {
    const startTime = Date.now();
    console.log(`Starting ${operationName} with ${ms}ms timeout`);

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(ms).then(() => {
            const duration = Date.now() - startTime;
            console.error(`${operationName} timed out after ${duration}ms`);
            reject(new Error(`${operationName} timed out after ${duration}ms`));
        })
    );

    try {
        const result = await Promise.race([asyncFunc(), timeoutPromise]);
        const duration = Date.now() - startTime;
        console.log(`${operationName} completed successfully in ${duration}ms`);
        return result;
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`${operationName} failed after ${duration}ms:`, error);
        throw error;
    }
}
// #endregion TIMEOUT_UTILITY

// #region WEBHOOK_VALIDATION
// Enhanced webhook validation with detailed logging
export function validateTrelloWebhook(req, res, next) {
    const startTime = Date.now();
    const requestId = crypto.randomBytes(16).toString('hex');

    console.log('\n=== START Webhook Validation ===');
    console.log('Request Details:', {
        id: requestId,
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        ip: req.ip
    });

    // Allow HEAD/OPTIONS requests without validation
    if (req.method === 'HEAD' || req.method === 'OPTIONS') {
        console.log(`${requestId}: Allowing ${req.method} request without validation`);
        return next();
    }

    if (req.method === 'POST') {
        const callbackURL = 'https://trello-sync-mirror-f28465526010.herokuapp.com/webhook/card-moved';

        try {
            console.log(`${requestId}: Validating POST request`);
            console.log('Validation Context:', {
                hasRawBody: !!req.rawBody,
                rawBodyLength: req.rawBody?.length,
                contentType: req.headers['content-type'],
                hasWebhookSignature: !!req.headers['x-trello-webhook'],
                hasApiSecret: !!process.env.TRELLO_API_SECRET
            });

            // Verify webhook signature
            const trelloSignature = req.headers['x-trello-webhook'];
            if (!trelloSignature) {
                console.error(`${requestId}: Missing webhook signature`);
                return res.status(401).send('Unauthorized: Missing webhook signature');
            }

            // Verify API secret
            if (!process.env.TRELLO_API_SECRET) {
                console.error(`${requestId}: API secret not configured`);
                return res.status(500).send('Internal Server Error: Missing API Secret');
            }

            // Validate body
            if (!req.rawBody) {
                console.error(`${requestId}: Empty request body`);
                return res.status(400).send('Bad Request: Empty body');
            }

            // Compute signature
            const hmac = crypto.createHmac('sha1', process.env.TRELLO_API_SECRET);
            const computedSignature = hmac
                .update(req.rawBody + callbackURL)
                .digest('base64');

            console.log('Signature Verification:', {
                requestId,
                received: trelloSignature,
                computed: computedSignature,
                matches: computedSignature === trelloSignature
            });

            if (computedSignature === trelloSignature) {
                const duration = Date.now() - startTime;
                console.log(`${requestId}: Validation successful (${duration}ms)`);
                return next();
            } else {
                console.error(`${requestId}: Signature mismatch`);
                return res.status(401).send('Unauthorized: Invalid webhook signature');
            }
        } catch (error) {
            console.error(`${requestId}: Validation error:`, {
                error: error.message,
                stack: error.stack,
                duration: Date.now() - startTime
            });
            return res.status(500).send('Internal Server Error');
        }
    }

    if (req.method === 'GET') {
        console.log(`${requestId}: Allowing GET request`);
        return next();
    }

    console.log(`${requestId}: Rejecting unsupported method: ${req.method}`);
    res.status(405).send('Method Not Allowed');
}
// #endregion WEBHOOK_VALIDATION

// #region WEBHOOK_ROUTES
// Enhanced webhook routes with detailed logging
export function createWebhookRoutes(app, trelloSync) {
    // Health check endpoint
    app.get('/', (req, res) => {
        console.log('Health check request received');
        res.send('Trello Sync Service is running!');
    });

    // Main webhook handler
    app.all('/webhook/card-moved', validateTrelloWebhook, async (req, res) => {
        const startTime = Date.now();
        const webhookId = crypto.randomBytes(8).toString('hex');

        // Immediate response to prevent timeout
        res.sendStatus(200);

        console.log('\n=== START Webhook Processing ===');
        console.log('Webhook Details:', {
            id: webhookId,
            timestamp: new Date().toISOString(),
            contentLength: req.get('content-length'),
            userAgent: req.get('user-agent')
        });

        try {
            if (!req.body.action) {
                console.log(`${webhookId}: No action in payload`);
                return;
            }

            const { action } = req.body;

            // Check if webhook was already processed
            if (webhookProcessor.isWebhookProcessed(action.id)) {
                console.log(`${webhookId}: Skipping duplicate webhook action: ${action.id}`);
                return;
            }

            // Mark webhook as processed immediately
            webhookProcessor.markWebhookProcessed(action.id);

            // Log webhook context
            console.log('Webhook Context:', {
                id: webhookId,
                actionType: action.type,
                actionId: action.id,
                board: {
                    id: action.data.board?.id,
                    name: action.data.board?.name,
                    isSource: config.sourceBoards.some(b => b.id === action.data.board?.id),
                    isAggregate: action.data.board?.id === config.aggregateBoard
                },
                card: {
                    id: action.data.card?.id,
                    name: action.data.card?.name,
                    shortLink: action.data.card?.shortLink
                },
                lists: {
                    current: action.data.list?.name,
                    after: action.data.listAfter?.name,
                    before: action.data.listBefore?.name
                }
            });

            // Log sync state
            console.log('Current Sync State:', {
                id: webhookId,
                listMappingCount: trelloSync.listMapping.size,
                cardMappingCount: trelloSync.cardMapping.size,
                processingTime: Date.now() - startTime
            });

            // Handle card actions
            if (['createCard', 'updateCard', 'addLabelToCard', 'deleteCard'].includes(action.type)) {
                console.log(`${webhookId}: Processing ${action.type} action`);

                const card = action.data.card;
                const board = action.data.board;
                let targetList;

                // Enhanced list determination
                if (action.type === 'addLabelToCard') {
                    console.log(`${webhookId}: Fetching card details for label action`);
                    try {
                        const fullCard = await trelloApi.request(`/cards/${card.id}`);
                        const fullList = await trelloApi.request(`/lists/${fullCard.idList}`);
                        targetList = fullList;

                        console.log('Card and List Details:', {
                            webhookId,
                            cardId: fullCard.id,
                            listId: fullList.id,
                            listName: fullList.name,
                            processingTime: Date.now() - startTime
                        });
                    } catch (error) {
                        console.error(`${webhookId}: Failed to fetch card details:`, error);
                        throw error;
                    }
                } else {
                    targetList = action.data.listAfter || action.data.list;
                }

                if (!targetList) {
                    console.error(`${webhookId}: No target list found`);
                    return;
                }

                // Process based on board type
                if (board.id === config.aggregateBoard) {
                    console.log(`${webhookId}: Processing aggregate board action`);
                    await withTimeout(
                        () => trelloSync.handleAggregateCardMove(card, targetList),
                        15000,
                        `Aggregate card move (${webhookId})`
                    );
                } else {
                    const sourceBoard = config.sourceBoards.find(b => b.id === board.id);
                    if (sourceBoard) {
                        console.log(`${webhookId}: Processing source board action`);

                        if (config.listNames.includes(targetList.name)) {
                            await withTimeout(
                                () => trelloSync.handleCardMove(card, sourceBoard, targetList),
                                15000,
                                `Source card move (${webhookId})`
                            );
                        } else {
                            console.log(`${webhookId}: List "${targetList.name}" not configured`);
                        }
                    } else {
                        console.log(`${webhookId}: Board ${board.id} not in source boards`);
                    }
                }
            } else {
                console.log(`${webhookId}: Ignoring unhandled action type: ${action.type}`);
            }

            // Log completion
            const duration = Date.now() - startTime;
            console.log('Webhook Processing Complete:', {
                id: webhookId,
                duration,
                actionType: action.type,
                status: 'success'
            });

        } catch (error) {
            const duration = Date.now() - startTime;
            console.error('Webhook Processing Failed:', {
                id: webhookId,
                duration,
                error: error.message,
                stack: error.stack,
                type: error.name,
                isTimeout: error.message.includes('timed out')
            });
        }
    });
}
// #endregion WEBHOOK_ROUTES