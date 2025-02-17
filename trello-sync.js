import { config } from './config.js';
import { trelloApi } from './trello-api.js';

export class TrelloSync {
    constructor() {
        this.listMapping = new Map();
        this.cardMapping = new Map();
        this.boardColorMap = config.boardMapping;
    }

    // Existing initialize method remains the same...
    async initialize() {
        console.log('Initializing TrelloSync...');
        console.log('Configured Source Boards:', JSON.stringify(config.sourceBoards, null, 2));
        console.log('Configured List Names:', JSON.stringify(config.listNames, null, 2));

        // Map lists for source boards
        for (const board of config.sourceBoards) {
            console.log(`Fetching lists for board: ${board.name} (${board.id})`);
            const lists = await trelloApi.getLists(board.id);
            console.log(`Lists found for ${board.name}:`, lists.map(l => l.name));

            for (const list of lists) {
                if (config.listNames.includes(list.name)) {
                    const mappingKey = `${board.id}-${list.name}`;
                    this.listMapping.set(mappingKey, list.id);
                    console.log(`Mapped ${mappingKey} to list ID: ${list.id}`);
                }
            }
        }

        // Map lists for aggregate board
        console.log(`Fetching lists for aggregate board: ${config.aggregateBoard}`);
        const aggregateLists = await trelloApi.getLists(config.aggregateBoard);
        console.log('Aggregate board lists:', aggregateLists.map(l => l.name));

        for (const list of aggregateLists) {
            if (config.listNames.includes(list.name)) {
                const mappingKey = `aggregate-${list.name}`;
                this.listMapping.set(mappingKey, list.id);
                console.log(`Mapped ${mappingKey} to list ID: ${list.id}`);
            }
        }

        console.log('Final List Mapping:');
        for (const [key, value] of this.listMapping.entries()) {
            console.log(`  ${key}: ${value}`);
        }

        console.log('TrelloSync initialized');
    }

    async handleDueDateListMovement(card, boardId) {
        // Detailed logging for debugging
        console.log(`Checking due date movement for card: ${card.name}`);
        console.log(`Card due date: ${card.due}`);

        // If no due date, return early
        if (!card.due) {
            console.log('No due date set, skipping list movement');
            return;
        }

        const today = new Date();
        const dueDate = new Date(card.due);
        const daysDifference = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
        console.log(`Days until due: ${daysDifference}`);

        // Find the appropriate target list based on due date
        const targetListPriority = config.listPriorities.find(priority =>
            priority.maxDays >= 0 &&
            (daysDifference <= priority.maxDays ||
                (priority.name === 'Vandaag' && dueDate <= today))
        );

        if (!targetListPriority) {
            console.log('No matching list priority found');
            return;
        }

        const targetListId = this.listMapping.get(`${boardId}-${targetListPriority.name}`);
        if (!targetListId) {
            console.error(`Target list not found: ${targetListPriority.name} for board ${boardId}`);
            return;
        }

        try {
            console.log(`Moving card to list: ${targetListPriority.name}`);
            await trelloApi.updateCard(card.id, { idList: targetListId });
            console.log(`Successfully moved card ${card.name} to ${targetListPriority.name}`);
        } catch (error) {
            console.error(`Error moving card ${card.name}:`, error);
        }
    }

    async performDailyCardMovement() {
        console.log('Starting daily card movement check');
        try {
            // Process each source board
            for (const board of config.sourceBoards) {
                console.log(`Processing board: ${board.name}`);
                try {
                    // Fetch all cards for the board
                    const cards = await trelloApi.getCards(board.id);
                    // Check and move each card
                    for (const card of cards) {
                        await this.handleDueDateListMovement(card, board.id);
                    }
                } catch (boardError) {
                    console.error(`Error processing board ${board.name}:`, boardError);
                }
            }
            console.log('Daily card movement check completed');
        } catch (error) {
            console.error('Error in daily card movement:', error);
        }
    }

    // Existing methods from before...
    async handleCardMove(card, sourceBoard, targetList) {
        const startTime = Date.now();
        console.log('\n=== ENTRY handleCardMove ===');
        console.log('Execution started at:', new Date().toISOString());
        console.log('Arguments received:', {
            card: JSON.stringify(card),
            sourceBoard: JSON.stringify(sourceBoard),
            targetList: JSON.stringify(targetList)
        });

        // Check and move card if it's in the Inbox and has a due date
        if (targetList.name === 'Inbox' && card.due) {
            await this.handleDueDateListMovement(card, sourceBoard.id);
        }

        // Rest of the existing handleCardMove method...
        try {
            const isConfiguredList = config.listNames.includes(targetList.name);
            console.log('Card creation decision factors:', {
                targetListName: targetList.name,
                isConfiguredList,
                configuredLists: config.listNames
            });

            const cardMappingKey = `${sourceBoard.id}-${card.id}`;
            let mirroredCardId = this.cardMapping.get(cardMappingKey);

            console.log('Card mapping status:', {
                cardMappingKey,
                existingMirroredCardId: mirroredCardId,
                mappingSize: this.cardMapping.size,
                elapsedMs: Date.now() - startTime
            });

            // Rest of the existing method remains the same...
            // (previous implementation continues here)
        } catch (error) {
            console.error('\n=== handleCardMove Error ===');
            console.error('Fatal error in handleCardMove:', {
                error: error.message,
                stack: error.stack,
                cardId: card.id,
                targetList: targetList.name,
                totalDurationMs: Date.now() - startTime
            });
            throw error;
        }
    }

    // Other existing methods from the original implementation...
    async handleAggregateCardMove(card, targetList) {
        // Existing implementation remains the same...
    }
}