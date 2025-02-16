import { config } from './config.js';
import { trelloApi } from './trello-api.js';

export class TrelloSync {
    constructor() {
        this.listMapping = new Map();
        this.cardMapping = new Map();

        // Define color mapping for different boards
        this.boardColorMap = {
            'prive': 'green_light',
            'mba': 'blue_dark',
            'opdracht': 'red_light',
            'tim-oudeboon-bv': 'orange_dark'
        };
    }

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

        // Log final list mapping for verification
        console.log('Final List Mapping:');
        for (const [key, value] of this.listMapping.entries()) {
            console.log(`  ${key}: ${value}`);
        }

        console.log('TrelloSync initialized');
    }

    async handleCardMove(card, sourceBoard, targetList) {
        try {
            console.log(`Processing card move: 
        Card Name: ${card.name}
        Card ID: ${card.id}
        Source Board: ${sourceBoard.name} (${sourceBoard.id})
        Target List: ${targetList.name}`);

            const isConfiguredList = config.listNames.includes(targetList.name);
            console.log(`Is target list configured? ${isConfiguredList}`);

            const cardMappingKey = `${sourceBoard.id}-${card.id}`;
            let mirroredCardId = this.cardMapping.get(cardMappingKey);

            console.log(`Existing Mirrored Card ID for ${cardMappingKey}: ${mirroredCardId}`);

            if (!mirroredCardId && isConfiguredList) {
                const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);

                if (!aggregateListId) {
                    console.error(`No aggregate list found for: aggregate-${targetList.name}`);
                    return;
                }

                try {
                    // Fetch full card details
                    const fullCard = await trelloApi.request(`/cards/${card.id}`);

                    // Create the origin label name
                    const originLabelName = `Origin:${sourceBoard.name}`;
                    let originLabelId = null;

                    try {
                        // Fetch labels for the aggregate board
                        const labels = await trelloApi.request(`/boards/${config.aggregateBoard}/labels`);
                        let existingLabel = labels.find(l => l.name === originLabelName);

                        // Determine the color for the new label
                        const labelColor = this.boardColorMap[sourceBoard.name] || 'blue_dark';

                        if (!existingLabel) {
                            // Create a new label if it doesn't exist
                            const newLabel = await trelloApi.request(`/boards/${config.aggregateBoard}/labels`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    name: originLabelName,
                                    color: labelColor
                                })
                            });

                            originLabelId = newLabel.id;
                        } else {
                            originLabelId = existingLabel.id;
                        }
                    } catch (labelError) {
                        console.error('Error handling label:', labelError);
                    }

                    // Combine original card's labels with the new origin label
                    const labelIds = fullCard.labels.map(label => label.id);
                    if (originLabelId) {
                        labelIds.push(originLabelId);
                    }

                    const mirroredCard = await trelloApi.createCard(aggregateListId, {
                        name: card.name,
                        desc: `Original board: ${sourceBoard.name}\n\n${card.desc || ''}`,
                        due: card.due,
                        idLabels: labelIds
                    });

                    mirroredCardId = mirroredCard.id;
                    this.cardMapping.set(cardMappingKey, mirroredCardId);
                    console.log(`Created mirrored card ${mirroredCardId}`);
                } catch (createError) {
                    console.error('Error creating mirrored card:', createError);
                }
            } else if (mirroredCardId) {
                if (isConfiguredList) {
                    try {
                        // Fetch full card details
                        const fullCard = await trelloApi.request(`/cards/${card.id}`);
                        const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);

                        await trelloApi.updateCard(mirroredCardId, {
                            idList: aggregateListId,
                            idLabels: fullCard.labels.map(label => label.id)
                        });
                        console.log(`Updated mirrored card ${mirroredCardId}`);
                    } catch (updateError) {
                        console.error('Error updating mirrored card:', updateError);
                    }
                } else {
                    try {
                        await trelloApi.deleteCard(mirroredCardId);
                        this.cardMapping.delete(cardMappingKey);
                        console.log(`Deleted mirrored card ${mirroredCardId}`);
                    } catch (deleteError) {
                        console.error('Error deleting mirrored card:', deleteError);
                    }
                }
            }
        } catch (mainError) {
            console.error('Unexpected error in handleCardMove:', mainError);
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
                throw updateError;
            }
        } catch (mainError) {
            console.error('Unexpected error in handleAggregateCardMove:', mainError);
        }
    }
}