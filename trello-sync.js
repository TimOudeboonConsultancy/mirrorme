import { config } from './config.js';
import { trelloApi } from './trello-api.js';

export class TrelloSync {
    constructor() {
        // Maps to store board and card relationships
        this.listMapping = new Map();
        this.cardMapping = new Map();
        // Color mapping for origin labels based on board configuration
        this.boardColorMap = config.boardMapping;
        // Add synchronization lock
        this.syncLock = new Map();
        // Track cards being processed
        this.processingCards = new Set();
    }

    async acquireLock(cardId, timeout = 5000) {
        const start = Date.now();
        while (this.syncLock.has(cardId)) {
            if (Date.now() - start > timeout) {
                throw new Error('Lock acquisition timeout');
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        this.syncLock.set(cardId, Date.now());
    }

    releaseLock(cardId) {
        this.syncLock.delete(cardId);
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
     * Find existing mirrored cards on the aggregate board
     * @param {Object} card - The original card
     * @param {Object} sourceBoard - The source board
     * @returns {Array} - Array of matching cards
     */
    async findExistingMirroredCards(card, sourceBoard) {
        try {
            const aggregateCards = await this.fetchWithRetry(() =>
                trelloApi.getCards(config.aggregateBoard)
            );

            return aggregateCards.filter(c =>
                c.name === card.name &&
                c.desc.includes(`Original board: ${sourceBoard.name}`)
            );
        } catch (error) {
            console.error('Error finding existing mirrored cards:', error);
            return [];
        }
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

        if (this.processingCards.has(card.id)) {
            console.log(`Card ${card.id} is already being processed, skipping movement`);
            return;
        }

        // Fetch full card details with retry mechanism
        let fullCard;
        try {
            this.processingCards.add(card.id);
            fullCard = await this.fetchWithRetry(() => trelloApi.request(`/cards/${card.id}`));
            console.log('Full card details:', JSON.stringify(fullCard, null, 2));
            console.log('Card Due Date:', fullCard.due);
        } catch (error) {
            console.error('Error fetching full card details:', error);
            this.processingCards.delete(card.id);
            return;
        }

        // If no due date is set, return early
        if (!fullCard.due) {
            console.log('No due date set, skipping list movement');
            this.processingCards.delete(card.id);
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalize to start of day

        const dueDate = new Date(fullCard.due);
        dueDate.setHours(0, 0, 0, 0); // Normalize to start of day

        const daysDifference = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

        console.log('Date Calculation:', {
            today: today.toISOString(),
            dueDate: dueDate.toISOString(),
            daysDifference
        });

        // Find the most appropriate target list - search from most urgent to least urgent
        let targetListPriority = null;

        // If due date is today or past
        if (daysDifference <= 0) {
            targetListPriority = config.listPriorities.find(p => p.name === 'Vandaag');
        }
        // If due within next 7 days
        else if (daysDifference <= 7) {
            targetListPriority = config.listPriorities.find(p => p.name === 'Komende 7 dagen');
        }
        // If due within next 30 days
        else if (daysDifference <= 30) {
            targetListPriority = config.listPriorities.find(p => p.name === 'Komende 30 dagen');
        }

        if (!targetListPriority) {
            console.log(`No matching list priority found for card due in ${daysDifference} days`);
            this.processingCards.delete(card.id);
            return;
        }

        console.log(`Selected target list: ${targetListPriority.name} based on days difference: ${daysDifference}`);

        const targetListId = this.listMapping.get(`${boardId}-${targetListPriority.name}`);

        if (!targetListId) {
            console.error(`Target list not found: ${targetListPriority.name} for board ${boardId}`);
            this.processingCards.delete(card.id);
            return;
        }

        // Check if card is already in the correct list
        if (fullCard.idList === targetListId) {
            console.log(`Card is already in the correct list: ${targetListPriority.name}`);
            this.processingCards.delete(card.id);
            return;
        }

        try {
            await this.acquireLock(card.id);
            await trelloApi.updateCard(card.id, { idList: targetListId });
            console.log(`Successfully moved card ${card.name} to ${targetListPriority.name}`);
        } catch (error) {
            console.error(`Error moving card ${card.name}:`, error);
        } finally {
            this.releaseLock(card.id);
            this.processingCards.delete(card.id);
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
        if (this.processingCards.has(card.id)) {
            console.log(`Card ${card.id} is already being processed, skipping movement`);
            return;
        }

        try {
            await this.acquireLock(card.id);
            this.processingCards.add(card.id);
            console.log(`Lock acquired for card: ${card.id}`);

            const startTime = Date.now();
            console.log('\n=== ENTRY handleCardMove ===');
            console.log('Execution started at:', new Date().toISOString());
            console.log('Arguments received:', {
                card: JSON.stringify(card),
                sourceBoard: JSON.stringify(sourceBoard),
                targetList: JSON.stringify(targetList)
            });

            // Add random delay to help with rate limiting
            await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 500)));

            const isConfiguredList = config.listNames.includes(targetList.name);
            const cardMappingKey = `${sourceBoard.id}-${card.id}`;
            let mirroredCardId = this.cardMapping.get(cardMappingKey);

            // Fetch full card details to check due date
            const fullCard = await this.fetchWithRetry(() => trelloApi.request(`/cards/${card.id}`));

            // Only handle due date movement for specific lists
            if (targetList.name === 'Inbox' && fullCard.due) {
                // Find the appropriate target list based on due date
                const targetListPriority = config.listPriorities.find(priority => {
                    const today = new Date();
                    const dueDate = new Date(fullCard.due);
                    const daysDifference = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

                    return (
                        priority.maxDays >= 0 &&
                        (daysDifference <= priority.maxDays ||
                            (priority.name === 'Vandaag' && dueDate <= today))
                    );
                });

                // If a target list is found, move the card
                if (targetListPriority) {
                    const targetListId = this.listMapping.get(`${sourceBoard.id}-${targetListPriority.name}`);

                    if (targetListId) {
                        console.log(`Auto-moving card to ${targetListPriority.name} due to due date`);
                        await trelloApi.updateCard(card.id, { idList: targetListId });
                        return; // Exit to prevent further processing
                    }
                }
            }

            // Check for existing mirrored cards
            if (!mirroredCardId && isConfiguredList) {
                const existingCards = await this.findExistingMirroredCards(card, sourceBoard);
                if (existingCards.length > 0) {
                    mirroredCardId = existingCards[0].id;
                    this.cardMapping.set(cardMappingKey, mirroredCardId);
                    console.log(`Found existing mirrored card: ${mirroredCardId}`);
                }
            }

            if (!mirroredCardId && isConfiguredList) {
                // Create new mirrored card
                mirroredCardId = await this.createMirroredCard(card, sourceBoard, targetList);
                this.cardMapping.set(cardMappingKey, mirroredCardId);
            } else if (mirroredCardId && isConfiguredList) {
                // Update existing mirrored card
                await this.updateMirroredCard(mirroredCardId, card, sourceBoard, targetList);
            } else if (mirroredCardId && !isConfiguredList) {
                // Delete mirrored card if moved to unconfigured list
                await this.deleteMirroredCard(mirroredCardId, cardMappingKey);
            }

            console.log(`Card synchronization completed in ${Date.now() - startTime}ms`);
        } catch (error) {
            console.error('Card synchronization failed:', {
                error: error.message,
                card: card.id,
                sourceBoard: sourceBoard.name,
                targetList: targetList.name
            });

            throw error;
        } finally {
            this.releaseLock(card.id);
            this.processingCards.delete(card.id);
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
            trelloApi.getLabels(config.aggregateBoard)
        );
        originLabel = labels.find(l => l.name === originLabelName);

        if (!originLabel) {
            originLabel = await this.fetchWithRetry(() =>
                trelloApi.createLabel(config.aggregateBoard, {
                    name: originLabelName,
                    color: labelColor
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
                idLabels: labelIds.length === 1 ? labelIds : []
            })
        );

        console.log(`Created new mirrored card: ${mirroredCard.id}`);
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
            trelloApi.getLabels(config.aggregateBoard)
        );
        const originLabel = labels.find(l => l.name === originLabelName);

        // Prepare label IDs - simplified to reduce errors
        const labelIds = originLabel ? [originLabel.id] : [];

        // Update mirrored card with minimal changes
        await this.fetchWithRetry(() =>
            trelloApi.updateCard(mirroredCardId, {
                idList: aggregateListId,
                name: card.name,
                desc: `Original board: ${sourceBoard.name}\n\n${fullCard.desc || ''}`,
                due: fullCard.due
            })
        );

        // Update labels in a separate call to reduce errors
        if (labelIds.length > 0) {
            await this.fetchWithRetry(() =>
                trelloApi.updateCard(mirroredCardId, {
                    idLabels: labelIds
                })
            );
        }

        console.log(`Updated mirrored card: ${mirroredCardId}`);
    }

    /**
     * Delete a mirrored card and remove its mapping
     * @param {string} mirroredCardId - The ID of the mirrored card to delete
     * @param {string} cardMappingKey - The mapping key to remove
     */
    async deleteMirroredCard(mirroredCardId, cardMappingKey) {
        await this.fetchWithRetry(() => trelloApi.deleteCard(mirroredCardId));
        this.cardMapping.delete(cardMappingKey);
        console.log(`Deleted mirrored card: ${mirroredCardId}`);
    }

    /**
     * Handle card movement on the aggregate board
     * @param {Object} card - The card being moved
     * @param {Object} targetList - The target list details
     */
    async handleAggregateCardMove(card, targetList) {
        if (this.processingCards.has(card.id)) {
            console.log(`Card ${card.id} is already being processed, skipping movement`);
            return;
        }

        try {
            await this.acquireLock(card.id);
            this.processingCards.add(card.id);

            console.log('=== Starting handleAggregateCardMove ===');
            console.log(`Processing card: ${card.name} (${card.id})`);
            console.log(`Target list: ${targetList.name}`);

            // Fetch full card details if needed
            let fullCard = card;
            if (!card.desc) {
                fullCard = await this.fetchWithRetry(() => trelloApi.request(`/cards/${card.id}`));
            }

            // Extract original board info from card description
            const boardMatch = fullCard.desc ? fullCard.desc.match(/Original board: (.*?)(?:\n|$)/) : null;
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

            console.log(`Successfully synchronized movement to source board`);
        } catch (error) {
            console.error('Error in handleAggregateCardMove:', error);
        } finally {
            this.releaseLock(card.id);
            this.processingCards.delete(card.id);
        }
    }
}