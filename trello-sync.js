import { config } from './config.js';
import { trelloApi } from './trello-api.js';

export class TrelloSync {
    constructor() {
        // Maps to store board and card relationships
        this.listMapping = new Map();
        this.cardMapping = new Map();
        // Color mapping for origin labels based on board configuration
        this.boardColorMap = config.boardMapping;
    }

    /**
     * Initialize the TrelloSync service by mapping lists across source and aggregate boards
     */
    async initialize() {
        console.log('Initializing TrelloSync...');
        console.log('Configured Source Boards:', JSON.stringify(config.sourceBoards, null, 2));
        console.log('Configured List Names:', JSON.stringify(config.listNames, null, 2));
        console.log('List Priorities:', JSON.stringify(config.listPriorities, null, 2));

        // Map lists for source boards
        for (const board of config.sourceBoards) {
            console.log(`Fetching lists for board: ${board.name} (${board.id})`);
            const lists = await this.fetchWithRetry(() => trelloApi.getLists(board.id));
            console.log(`Lists found for ${board.name}:`, lists.map(l => l.name));

            for (const list of lists) {
                const mappingKey = `${board.id}-${list.name}`;
                this.listMapping.set(mappingKey, list.id);
                console.log(`Mapped ${mappingKey} to list ID: ${list.id}`);
            }
        }

        // Map lists for aggregate board
        console.log(`Fetching lists for aggregate board: ${config.aggregateBoard}`);
        const aggregateLists = await this.fetchWithRetry(() => trelloApi.getLists(config.aggregateBoard));
        console.log('Aggregate board lists:', aggregateLists.map(l => l.name));

        for (const list of aggregateLists) {
            const mappingKey = `aggregate-${list.name}`;
            this.listMapping.set(mappingKey, list.id);
            console.log(`Mapped ${mappingKey} to list ID: ${list.id}`);
        }

        console.log('Final List Mapping:');
        for (const [key, value] of this.listMapping.entries()) {
            console.log(`  ${key}: ${value}`);
        }

        console.log('TrelloSync initialized');
    }

    /**
     * Retry mechanism for API calls with exponential backoff
     * @param {Function} apiCall - The API call to execute
     * @param {number} maxRetries - Maximum number of retry attempts
     * @returns {Promise} - Resolves with the API response
     */
    async fetchWithRetry(apiCall, maxRetries = 3) {
        const baseDelay = 1000; // 1 second initial delay

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await apiCall();
            } catch (error) {
                // Check for rate limiting
                if (error.status === 429) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    const jitter = Math.floor(Math.random() * 500); // Add some randomness
                    const waitTime = delay + jitter;

                    console.warn(`Rate limit hit. Retry attempt ${attempt}. Waiting ${waitTime}ms`);

                    // Wait before retrying
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    // For non-rate limit errors, rethrow immediately
                    throw error;
                }
            }
        }

        throw new Error('API call failed after maximum retries');
    }

    /**
     * Handle automatic list movement based on card's due date
     * @param {Object} card - The card to potentially move
     * @param {string} boardId - The source board ID
     */
    async handleDueDateListMovement(card, boardId) {
        console.log('=== Starting handleDueDateListMovement ===');
        console.log(`Card details:`, JSON.stringify(card, null, 2));
        console.log(`Board ID: ${boardId}`);

        // Fetch full card details with retry mechanism
        let fullCard;
        try {
            fullCard = await this.fetchWithRetry(() => trelloApi.request(`/cards/${card.id}`));
            console.log('Full card details:', JSON.stringify(fullCard, null, 2));
            console.log('Card Due Date:', fullCard.due);
        } catch (error) {
            console.error('Error fetching full card details:', error);
            return;
        }

        // If no due date is set, return early
        if (!fullCard.due) {
            console.log('No due date set, skipping list movement');
            return;
        }

        const today = new Date();
        const dueDate = new Date(fullCard.due);
        const daysDifference = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

        console.log('Date Calculation:', {
            today: today.toISOString(),
            dueDate: dueDate.toISOString(),
            daysDifference
        });

        // Find the appropriate target list based on due date
        const targetListPriority = config.listPriorities.find(priority => {
            return (
                priority.maxDays >= 0 &&
                (daysDifference <= priority.maxDays ||
                    (priority.name === 'Vandaag' && dueDate <= today))
            );
        });

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
            await trelloApi.updateCard(card.id, { idList: targetListId });
            console.log(`Successfully moved card ${card.name} to ${targetListPriority.name}`);
        } catch (error) {
            console.error(`Error moving card ${card.name}:`, error);
        }
    }

    /**
     * Perform daily automatic card movement across all source boards
     */
    async performDailyCardMovement() {
        console.log('Starting daily card movement check');
        try {
            // Process each source board
            for (const board of config.sourceBoards) {
                console.log(`Processing board: ${board.name}`);
                try {
                    // Fetch all cards for the board
                    const cards = await this.fetchWithRetry(() => trelloApi.getCards(board.id));
                    console.log(`Found ${cards.length} cards on board ${board.name}`);

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

    /**
     * Handle card movement across boards, creating or updating mirrored cards
     * @param {Object} card - The card being moved
     * @param {Object} sourceBoard - The source board details
     * @param {Object} targetList - The target list details
     */
    async handleCardMove(card, sourceBoard, targetList) {
        const startTime = Date.now();
        console.log('\n=== ENTRY handleCardMove ===');
        console.log('Execution started at:', new Date().toISOString());
        console.log('Arguments received:', {
            card: JSON.stringify(card),
            sourceBoard: JSON.stringify(sourceBoard),
            targetList: JSON.stringify(targetList)
        });

        try {
            // Add random delay to help with rate limiting
            await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 500)));

            // Process card in Inbox for due date movement
            if (targetList.name === 'Inbox') {
                const fullCard = await this.fetchWithRetry(() => trelloApi.request(`/cards/${card.id}`));

                // Check if card has a due date
                if (fullCard.due) {
                    await this.handleDueDateListMovement(card, sourceBoard.id);
                }
            }

            const isConfiguredList = config.listNames.includes(targetList.name);
            const cardMappingKey = `${sourceBoard.id}-${card.id}`;
            let mirroredCardId = this.cardMapping.get(cardMappingKey);

            if (!mirroredCardId && isConfiguredList) {
                // Create new mirrored card
                mirroredCardId = await this.createMirroredCard(card, sourceBoard, targetList);
                this.cardMapping.set(cardMappingKey, mirroredCardId);
            } else if (mirroredCardId) {
                if (isConfiguredList) {
                    // Update existing mirrored card
                    await this.updateMirroredCard(mirroredCardId, card, sourceBoard, targetList);
                } else {
                    // Delete mirrored card if moved to unconfigured list
                    await this.deleteMirroredCard(mirroredCardId, cardMappingKey);
                }
            }

            console.log('Card synchronization completed successfully');
        } catch (error) {
            console.error('Card synchronization failed:', {
                error: error.message,
                card: card.id,
                sourceBoard: sourceBoard.name,
                targetList: targetList.name
            });

            // Attempt to recreate mirrored card if it was deleted
            if (error.status === 404) {
                try {
                    const mirroredCardId = await this.recreateMirroredCard(card, sourceBoard, targetList);
                    this.cardMapping.set(`${sourceBoard.id}-${card.id}`, mirroredCardId);
                } catch (recreationError) {
                    console.error('Failed to recreate mirrored card:', recreationError);
                }
            }

            throw error;
        }
    }

    /**
     * Create a mirrored card on the aggregate board
     * @param {Object} card - The original card
     * @param {Object} sourceBoard - The source board details
     * @param {Object} targetList - The target list details
     * @returns {string} - The ID of the created mirrored card
     */
    async createMirroredCard(card, sourceBoard, targetList) {
        const fullCard = await this.fetchWithRetry(() => trelloApi.request(`/cards/${card.id}`));
        const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);

        if (!aggregateListId) {
            throw new Error(`No aggregate list found for: ${targetList.name}`);
        }

        // Handle origin label
        const originLabelName = `Origin:${sourceBoard.name}`;
        const labelColor = this.boardColorMap[sourceBoard.name] || 'blue';

        // Fetch or create origin label with retry
        let originLabel;
        const labels = await this.fetchWithRetry(() =>
            trelloApi.request(`/boards/${config.aggregateBoard}/labels`)
        );
        originLabel = labels.find(l => l.name === originLabelName);

        if (!originLabel) {
            originLabel = await this.fetchWithRetry(() =>
                trelloApi.request(`/boards/${config.aggregateBoard}/labels`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: originLabelName,
                        color: labelColor
                    })
                })
            );
        }

        // Prepare label IDs
        const labelIds = fullCard.labels ?
            fullCard.labels.map(label => label.id).concat(originLabel.id) :
            [originLabel.id];

        // Create mirrored card
        const mirroredCard = await this.fetchWithRetry(() =>
            trelloApi.createCard(aggregateListId, {
                name: card.name,
                desc: `Original board: ${sourceBoard.name}\n\n${fullCard.desc || ''}`,
                due: fullCard.due,
                idLabels: labelIds
            })
        );

        return mirroredCard.id;
    }

    /**
     * Update an existing mirrored card on the aggregate board
     * @param {string} mirroredCardId - The ID of the mirrored card
     * @param {Object} card - The original card
     * @param {Object} sourceBoard - The source board details
     * @param {Object} targetList - The target list details
     */
    async updateMirroredCard(mirroredCardId, card, sourceBoard, targetList) {
        const fullCard = await this.fetchWithRetry(() => trelloApi.request(`/cards/${card.id}`));
        const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);

        if (!aggregateListId) {
            throw new Error(`No aggregate list found for: ${targetList.name}`);
        }

        // Handle origin label
        const originLabelName = `Origin:${sourceBoard.name}`;
        const labels = await this.fetchWithRetry(() =>
            trelloApi.request(`/boards/${config.aggregateBoard}/labels`)
        );
        const originLabel = labels.find(l => l.name === originLabelName);

        // Prepare label IDs
        const labelIds = fullCard.labels ?
            fullCard.labels.map(label => label.id) :
            [];

        if (originLabel) {
            labelIds.push(originLabel.id);
        }

        // Update mirrored card
        await this.fetchWithRetry(() =>
            trelloApi.updateCard(mirroredCardId, {
                idList: aggregateListId,
                idLabels: labelIds,
                due: fullCard.due,
                name: card.name,
                desc: `Original board: ${sourceBoard.name}\n\n${fullCard.desc || ''}`
            })
        );
    }

    /**
     * Delete a mirrored card and remove its mapping
     * @param {string} mirroredCardId - The ID of the mirrored card to delete
     * @param {string} cardMappingKey - The mapping key to remove
     */
    async deleteMirroredCard(mirroredCardId, cardMappingKey) {
        await this.fetchWithRetry(() => trelloApi.deleteCard(mirroredCardId));
        this.cardMapping.delete(cardMappingKey);
    }

    /**
     * Recreate a mirrored card that may have been deleted
     * @param {Object} card - The original card
     * @param {Object} sourceBoard - The source board details
     * @param {Object} targetList - The target list details
     * @returns {string} - The ID of the recreated mirrored card
     */
    async recreateMirroredCard(card, sourceBoard, targetList) {
        try {
            const mirroredCardId = await this.createMirroredCard(card, sourceBoard, targetList);
            return mirroredCardId;
        } catch (error) {
            console.error('Detailed error during mirrored card recreation:', {
                error: error.message,
                stack: error.stack,
                cardId: card.id,
                sourceBoardName: sourceBoard.name,
                targetListName: targetList.name
            });
            throw error;
        }
    }

    /**
     * Handle card movement on the aggregate board
     * @param {Object} card - The card being moved
     * @param {Object} targetList - The target list details
     */
    async handleAggregateCardMove(card, targetList) {
        try {
            console.log('=== Starting handleAggregateCardMove ===');
            console.log(`Processing card: ${card.name} (${card.id})`);
            console.log(`Target list: ${targetList.name}`);

            // Fetch full card details if description is missing
            if (!card.desc) {
                card = await this.fetchWithRetry(() => trelloApi.request(`/cards/${card.id}`));
            }

            // Extract original board info from card description
            const boardMatch = card.desc ? card.desc.match(/Original board: (.*?)(?:\n|$)/) : null;
            if (!boardMatch) {
                console.log('No original board info found in card description');
                return;
            }

            const originalBoardName = boardMatch[1];
            const sourceBoard = config.sourceBoards.find(b => b.name === originalBoardName);
            if (!sourceBoard) {
                console.log(`Source board not found for name: ${originalBoardName}`);
                return;
            }

            // Find the original card ID from the mapping
            let originalCardId = null;
            for (const [mappingKey, mirroredId] of this.cardMapping.entries()) {
                if (mirroredId === card.id) {
                    const [boardId, cardId] = mappingKey.split('-');
                    if (boardId === sourceBoard.id) {
                        originalCardId = cardId;
                        break;
                    }
                }
            }

            if (!originalCardId) {
                console.log('Original card not found in mapping');
                return;
            }

            // Get the corresponding list ID on the source board
            const sourceListId = this.listMapping.get(`${sourceBoard.id}-${targetList.name}`);
            if (!sourceListId) {
                console.log(`No matching list found on source board for: ${targetList.name}`);
                return;
            }

            // Update the card on the original board
            await this.fetchWithRetry(() =>
                trelloApi.updateCard(originalCardId, {
                    idList: sourceListId,
                })
            );
        } catch (error) {
            console.error('Error in handleAggregateCardMove:', error);
        }
    }
}