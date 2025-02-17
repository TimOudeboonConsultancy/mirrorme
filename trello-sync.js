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

    async handleCardMove(card, sourceBoard, targetList) {
        try {
            console.log('=== Detailed Card Move Debugging ===');
            console.log('Card Details:', JSON.stringify(card, null, 2));
            console.log('Source Board:', JSON.stringify(sourceBoard, null, 2));
            console.log('Target List:', JSON.stringify(targetList, null, 2));
            console.log('Current List Mappings:', Array.from(this.listMapping.entries()));

            const isConfiguredList = config.listNames.includes(targetList.name);
            console.log(`Is target list configured? ${isConfiguredList}`);

            const cardMappingKey = `${sourceBoard.id}-${card.id}`;
            let mirroredCardId = this.cardMapping.get(cardMappingKey);

            console.log(`Existing Mirrored Card ID for ${cardMappingKey}: ${mirroredCardId}`);

            if (!mirroredCardId && isConfiguredList) {
                const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);
                console.log(`Aggregate List ID for ${targetList.name}: ${aggregateListId}`);

                if (!aggregateListId) {
                    console.error(`No aggregate list found for: aggregate-${targetList.name}`);
                    console.log('Current list mappings:', Array.from(this.listMapping.entries()));
                    return;
                }

                try {
                    // Fetch full card details
                    console.log('Fetching full card details...');
                    const fullCard = await trelloApi.request(`/cards/${card.id}`);
                    console.log('Full Card Details:', JSON.stringify(fullCard, null, 2));

                    // Create the origin label name using the configured label
                    const originLabelName = `Origin:${sourceBoard.label || sourceBoard.name}`;
                    let originLabelId = null;

                    try {
                        // Fetch labels for the aggregate board
                        console.log('Fetching aggregate board labels...');
                        const labels = await trelloApi.request(`/boards/${config.aggregateBoard}/labels`);
                        console.log('Existing Labels:', JSON.stringify(labels, null, 2));

                        let existingLabel = labels.find(l => l.name === originLabelName);

                        // Determine the color for the new label
                        const labelColor = this.boardColorMap[sourceBoard.name] || 'blue';
                        console.log('Label parameters:', {
                            originLabelName,
                            labelColor,
                            existingLabel: existingLabel ? existingLabel.id : 'none found'
                        });

                        if (!existingLabel) {
                            // Create a new label if it doesn't exist
                            console.log(`Creating new label: ${originLabelName} with color ${labelColor}`);
                            const newLabel = await trelloApi.request(`/boards/${config.aggregateBoard}/labels`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    name: originLabelName,
                                    color: labelColor
                                })
                            });

                            originLabelId = newLabel.id;
                            console.log(`Created new label: ${originLabelName} with color ${labelColor}, ID: ${originLabelId}`);
                        } else {
                            originLabelId = existingLabel.id;
                            console.log(`Using existing label: ${originLabelName}, ID: ${originLabelId}`);
                        }
                    } catch (labelError) {
                        console.error('Error handling label:', labelError);
                        console.error('Label error details:', {
                            message: labelError.message,
                            stack: labelError.stack,
                            response: labelError.response
                        });
                    }

                    // Combine original card's labels with the new origin label
                    const labelIds = fullCard.labels ? fullCard.labels.map(label => label.id) : [];
                    if (originLabelId) {
                        labelIds.push(originLabelId);
                    }

                    console.log('About to create mirrored card with:', {
                        listId: aggregateListId,
                        name: card.name,
                        desc: `Original board: ${sourceBoard.name}\n\n${card.desc || ''}`,
                        due: card.due,
                        labelIds: labelIds,
                        aggregateBoard: config.aggregateBoard
                    });

                    try {
                        const mirroredCard = await trelloApi.createCard(aggregateListId, {
                            name: card.name,
                            desc: `Original board: ${sourceBoard.name}\n\n${card.desc || ''}`,
                            due: card.due,
                            idLabels: labelIds
                        });

                        console.log('Successfully created mirrored card:', mirroredCard);

                        mirroredCardId = mirroredCard.id;
                        this.cardMapping.set(cardMappingKey, mirroredCardId);
                        console.log(`Created mirrored card ${mirroredCardId} with labels: ${labelIds.join(', ')}`);
                    } catch (createError) {
                        console.error('Error details from card creation:', {
                            error: createError.message,
                            stack: createError.stack,
                            response: createError.response
                        });
                        throw createError;
                    }
                } catch (mainError) {
                    console.error('Error creating mirrored card:', mainError);
                    console.error('Full error details:', {
                        message: mainError.message,
                        stack: mainError.stack,
                        response: mainError.response
                    });
                }
            } else if (mirroredCardId) {
                if (isConfiguredList) {
                    try {
                        // Fetch full card details
                        const fullCard = await trelloApi.request(`/cards/${card.id}`);
                        const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);

                        if (!aggregateListId) {
                            console.error(`No aggregate list found for: aggregate-${targetList.name}`);
                            console.log('Current list mappings:', Array.from(this.listMapping.entries()));
                            return;
                        }

                        await trelloApi.updateCard(mirroredCardId, {
                            idList: aggregateListId,
                            idLabels: fullCard.labels ? fullCard.labels.map(label => label.id) : []
                        });
                        console.log(`Updated mirrored card ${mirroredCardId}`);
                    } catch (updateError) {
                        console.error('Error updating mirrored card:', updateError);
                        console.error('Update error details:', {
                            message: updateError.message,
                            stack: updateError.stack,
                            response: updateError.response
                        });
                    }
                } else {
                    try {
                        await trelloApi.deleteCard(mirroredCardId);
                        this.cardMapping.delete(cardMappingKey);
                        console.log(`Deleted mirrored card ${mirroredCardId}`);
                    } catch (deleteError) {
                        console.error('Error deleting mirrored card:', deleteError);
                        console.error('Delete error details:', {
                            message: deleteError.message,
                            stack: deleteError.stack,
                            response: deleteError.response
                        });
                    }
                }
            }
        } catch (mainError) {
            console.error('Unexpected error in handleCardMove:', mainError);
            console.error('Full error details:', {
                message: mainError.message,
                stack: mainError.stack,
                response: mainError.response
            });
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