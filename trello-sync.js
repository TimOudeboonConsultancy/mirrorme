import { config } from './config.js';
import { trelloApi } from './trello-api.js';

export class TrelloSync {
    constructor() {
        this.listMapping = new Map();
        this.cardMapping = new Map();
        this.boardColorMap = config.boardMapping;
    }

    async initialize() {
        console.log('Initializing TrelloSync...');
        console.log('Configured Source Boards:', JSON.stringify(config.sourceBoards, null, 2));
        console.log('Configured List Names:', JSON.stringify(config.listNames, null, 2));
        console.log('List Priorities:', JSON.stringify(config.listPriorities, null, 2));

        // Map lists for source boards
        for (const board of config.sourceBoards) {
            console.log(`Fetching lists for board: ${board.name} (${board.id})`);
            const lists = await trelloApi.getLists(board.id);
            console.log(`Lists found for ${board.name}:`, lists.map(l => l.name));

            for (const list of lists) {
                const mappingKey = `${board.id}-${list.name}`;
                this.listMapping.set(mappingKey, list.id);
                console.log(`Mapped ${mappingKey} to list ID: ${list.id}`);
            }
        }

        // Map lists for aggregate board
        console.log(`Fetching lists for aggregate board: ${config.aggregateBoard}`);
        const aggregateLists = await trelloApi.getLists(config.aggregateBoard);
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

    async handleDueDateListMovement(card, boardId) {
        console.log('=== Starting handleDueDateListMovement ===');
        console.log(`Card details:`, JSON.stringify(card, null, 2));
        console.log(`Board ID: ${boardId}`);

        // Fetch full card details to ensure we have the due date
        let fullCard;
        try {
            fullCard = await trelloApi.request(`/cards/${card.id}`);
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
            console.log('Checking list priority:', priority);
            return (
                priority.maxDays >= 0 &&
                (daysDifference <= priority.maxDays ||
                    (priority.name === 'Vandaag' && dueDate <= today))
            );
        });

        console.log('Target List Priority:', JSON.stringify(targetListPriority, null, 2));

        if (!targetListPriority) {
            console.log('No matching list priority found');
            return;
        }

        const targetListId = this.listMapping.get(`${boardId}-${targetListPriority.name}`);

        console.log('List Mapping Details:', {
            lookupKey: `${boardId}-${targetListPriority.name}`,
            targetListId,
            fullListMapping: Object.fromEntries(this.listMapping)
        });

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
            // Process card in Inbox for due date movement
            if (targetList.name === 'Inbox') {
                console.log('Processing card in Inbox');
                const fullCard = await trelloApi.request(`/cards/${card.id}`);

                // Check if card has a due date
                if (fullCard.due) {
                    console.log('Card has a due date, initiating list movement');
                    await this.handleDueDateListMovement(card, sourceBoard.id);
                }
            }

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

            console.log('\n=== handleCardMove Completion ===');
            console.log('Operation completed successfully:', {
                totalDurationMs: Date.now() - startTime,
                cardId: card.id,
                targetList: targetList.name
            });
        } catch (error) {
            console.error('\n=== handleCardMove Error ===');
            console.error('Detailed error in handleCardMove:', {
                error: error.message,
                stack: error.stack,
                response: error.response,
                cardId: card.id,
                sourceBoard: sourceBoard.name,
                targetList: targetList.name,
                totalDurationMs: Date.now() - startTime
            });

            // Attempt to recreate mirrored card if it was deleted
            if (error.status === 404) {
                try {
                    console.log('Attempting to recreate mirrored card...');
                    const mirroredCardId = await this.recreateMirroredCard(card, sourceBoard, targetList);
                    this.cardMapping.set(`${sourceBoard.id}-${card.id}`, mirroredCardId);
                    console.log('Mirrored card recreation successful');
                } catch (recreationError) {
                    console.error('Failed to recreate mirrored card:', {
                        error: recreationError.message,
                        stack: recreationError.stack
                    });
                }
            }

            throw error;
        }
    }

    async createMirroredCard(card, sourceBoard, targetList) {
        console.log('\n=== START Creating Mirrored Card ===');
        const fullCard = await trelloApi.request(`/cards/${card.id}`);
        const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);

        if (!aggregateListId) {
            throw new Error(`No aggregate list found for: ${targetList.name}`);
        }

        // Handle origin label
        const originLabelName = `Origin:${sourceBoard.name}`;
        const labelColor = this.boardColorMap[sourceBoard.name] || 'blue';

        let originLabel;
        try {
            const labels = await trelloApi.request(`/boards/${config.aggregateBoard}/labels`);
            originLabel = labels.find(l => l.name === originLabelName);

            if (!originLabel) {
                originLabel = await trelloApi.request(`/boards/${config.aggregateBoard}/labels`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: originLabelName,
                        color: labelColor
                    })
                });
            }
        } catch (labelError) {
            console.error('Label processing error:', labelError);
            throw labelError;
        }

        // Prepare label IDs
        const labelIds = fullCard.labels ?
            fullCard.labels.map(label => label.id).concat(originLabel.id) :
            [originLabel.id];

        // Create mirrored card
        const mirroredCard = await trelloApi.createCard(aggregateListId, {
            name: card.name,
            desc: `Original board: ${sourceBoard.name}\n\n${fullCard.desc || ''}`,
            due: fullCard.due,
            idLabels: labelIds
        });

        console.log('Mirrored card created successfully:', {
            mirroredCardId: mirroredCard.id,
            sourceBoardName: sourceBoard.name,
            targetListName: targetList.name
        });

        return mirroredCard.id;
    }

    async updateMirroredCard(mirroredCardId, card, sourceBoard, targetList) {
        console.log('\n=== START Card Update ===');
        const fullCard = await trelloApi.request(`/cards/${card.id}`);
        const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);

        if (!aggregateListId) {
            throw new Error(`No aggregate list found for: ${targetList.name}`);
        }

        // Handle origin label
        const originLabelName = `Origin:${sourceBoard.name}`;
        let originLabel;
        try {
            const labels = await trelloApi.request(`/boards/${config.aggregateBoard}/labels`);
            originLabel = labels.find(l => l.name === originLabelName);
        } catch (labelError) {
            console.error('Label lookup error:', labelError);
        }

        // Prepare label IDs
        const labelIds = fullCard.labels ?
            fullCard.labels.map(label => label.id) :
            [];

        if (originLabel) {
            labelIds.push(originLabel.id);
        }

        // Update mirrored card
        await trelloApi.updateCard(mirroredCardId, {
            idList: aggregateListId,
            idLabels: labelIds,
            due: fullCard.due,
            name: card.name,
            desc: `Original board: ${sourceBoard.name}\n\n${fullCard.desc || ''}`
        });

        console.log('Mirrored card updated successfully:', {
            mirroredCardId,
            sourceBoardName: sourceBoard.name,
            targetListName: targetList.name
        });
    }

    async deleteMirroredCard(mirroredCardId, cardMappingKey) {
        console.log('\n=== START Card Deletion ===');
        await trelloApi.deleteCard(mirroredCardId);
        this.cardMapping.delete(cardMappingKey);
        console.log('Mirrored card deleted:', {
            mirroredCardId,
            removedMapping: cardMappingKey
        });
    }

    async recreateMirroredCard(card, sourceBoard, targetList) {
        console.log('\n=== START Recreating Mirrored Card ===');
        try {
            // This method is similar to createMirroredCard but with more comprehensive error handling
            const mirroredCardId = await this.createMirroredCard(card, sourceBoard, targetList);

            console.log('Mirrored card recreation successful:', {
                newCardId: mirroredCardId,
                sourceBoardName: sourceBoard.name,
                targetListName: targetList.name
            });

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

    async handleAggregateCardMove(card, targetList) {
        try {
            console.log('=== Starting handleAggregateCardMove ===');
            console.log(`Processing card: ${card.name} (${card.id})`);
            console.log(`Target list: ${targetList.name}`);

            // Check if card has a description
            if (!card.desc) {
                console.log('Card has no description, fetching full card details...');
                try {
                    card = await trelloApi.request(`/cards/${card.id}`);
                } catch (fetchError) {
                    console.error('Error fetching card details:', fetchError);
                    console.error('Fetch error details:', {
                        message: fetchError.message,
                        stack: fetchError.stack,
                        response: fetchError.response
                    });
                    return;
                }
            }

            // Extract original board info from card description
            const boardMatch = card.desc ? card.desc.match(/Original board: (.*?)(?:\n|$)/) : null;
            if (!boardMatch) {
                console.log('No original board info found in card description:', card.desc);
                return;
            }

            const originalBoardName = boardMatch[1];
            console.log(`Original board name found: ${originalBoardName}`);

            // Find the source board configuration
            const sourceBoard = config.sourceBoards.find(b => b.name === originalBoardName);
            if (!sourceBoard) {
                console.log(`Source board not found for name: ${originalBoardName}`);
                return;
            }
            console.log(`Found source board: ${sourceBoard.name} (${sourceBoard.id})`);

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
                console.log('Original card not found in mapping. Current mapping:',
                    Array.from(this.cardMapping.entries()));
                return;
            }
            console.log(`Found original card ID: ${originalCardId}`);

            // Get the corresponding list ID on the source board
            const sourceListId = this.listMapping.get(`${sourceBoard.id}-${targetList.name}`);
            if (!sourceListId) {
                console.log(`No matching list found on source board for: ${targetList.name}`);
                console.log('Current list mapping:', Array.from(this.listMapping.entries()));
                return;
            }
            console.log(`Found source list ID: ${sourceListId}`);

            try {
                // Update the card on the original board
                await trelloApi.updateCard(originalCardId, {
                    idList: sourceListId,
                });
                console.log(`Successfully updated original card ${originalCardId} to list ${sourceListId}`);
            } catch (updateError) {
                console.error('Error updating original card:', updateError);
                console.error('Update error details:', {
                    message: updateError.message,
                    stack: updateError.stack,
                    response: updateError.response
                });
                throw updateError;
            }
        } catch (mainError) {
            console.error('Unexpected error in handleAggregateCardMove:', mainError);
            console.error('Full error details:', {
                message: mainError.message,
                stack: mainError.stack,
                response: mainError.response
            });
        }
    }
}