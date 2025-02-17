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
        const startTime = Date.now();
        console.log('\n=== ENTRY handleCardMove ===');
        console.log('Execution started at:', new Date().toISOString());
        console.log('Arguments received:', {
            card: JSON.stringify(card),
            sourceBoard: JSON.stringify(sourceBoard),
            targetList: JSON.stringify(targetList)
        });

        try {
            console.log('\n=== Detailed Card Move Debugging ===');
            console.log('Processing timing:', {
                startTime,
                elapsedMs: Date.now() - startTime
            });

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
                console.log('\n=== START Creating Mirrored Card ===');
                const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);
                console.log('Aggregate list lookup:', {
                    lookupKey: `aggregate-${targetList.name}`,
                    aggregateListId,
                    allMappings: Array.from(this.listMapping.entries()),
                    elapsedMs: Date.now() - startTime
                });

                if (!aggregateListId) {
                    console.error('No aggregate list found:', {
                        lookupKey: `aggregate-${targetList.name}`,
                        availableMappings: Array.from(this.listMapping.entries())
                    });
                    return;
                }

                try {
                    console.log('\n=== START Fetching Card Details ===');
                    console.log('Fetching full card details for:', card.id);
                    const fullCard = await trelloApi.request(`/cards/${card.id}`);
                    console.log('Full card details retrieved:', {
                        cardId: fullCard.id,
                        name: fullCard.name,
                        labels: fullCard.labels,
                        elapsedMs: Date.now() - startTime
                    });

                    console.log('\n=== START Label Processing ===');
                    const originLabelName = `Origin:${sourceBoard.label || sourceBoard.name}`;
                    let originLabelId = null;

                    try {
                        console.log('Fetching aggregate board labels...');
                        const labels = await trelloApi.request(`/boards/${config.aggregateBoard}/labels`);
                        console.log('Label fetch complete:', {
                            totalLabels: labels.length,
                            elapsedMs: Date.now() - startTime
                        });

                        let existingLabel = labels.find(l => l.name === originLabelName);
                        const labelColor = this.boardColorMap[sourceBoard.name] || 'blue';

                        console.log('Label determination:', {
                            originLabelName,
                            labelColor,
                            existingLabelFound: !!existingLabel,
                            elapsedMs: Date.now() - startTime
                        });

                        if (!existingLabel) {
                            console.log(`Creating new label: ${originLabelName}`);
                            const newLabel = await trelloApi.request(`/boards/${config.aggregateBoard}/labels`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    name: originLabelName,
                                    color: labelColor
                                })
                            });
                            originLabelId = newLabel.id;
                            console.log('New label created:', {
                                labelId: originLabelId,
                                name: originLabelName,
                                elapsedMs: Date.now() - startTime
                            });
                        } else {
                            originLabelId = existingLabel.id;
                            console.log('Using existing label:', {
                                labelId: originLabelId,
                                name: originLabelName,
                                elapsedMs: Date.now() - startTime
                            });
                        }
                    } catch (labelError) {
                        console.error('Label processing error:', {
                            error: labelError.message,
                            stack: labelError.stack,
                            response: labelError.response,
                            elapsedMs: Date.now() - startTime
                        });
                        throw labelError;
                    }

                    const labelIds = fullCard.labels ? fullCard.labels.map(label => label.id) : [];
                    if (originLabelId) {
                        labelIds.push(originLabelId);
                    }

                    console.log('\n=== START Card Creation ===');
                    const cardCreationData = {
                        name: card.name,
                        desc: `Original board: ${sourceBoard.name}\n\n${card.desc || ''}`,
                        due: card.due,
                        idLabels: labelIds
                    };

                    console.log('Attempting card creation:', {
                        listId: aggregateListId,
                        cardData: cardCreationData,
                        elapsedMs: Date.now() - startTime
                    });

                    try {
                        const timeUntilTimeout = 15000 - (Date.now() - startTime);
                        console.log(`Time remaining before timeout: ${timeUntilTimeout}ms`);

                        if (timeUntilTimeout < 2000) {
                            console.warn('Warning: Approaching timeout limit');
                        }

                        const mirroredCard = await trelloApi.createCard(aggregateListId, cardCreationData);
                        console.log('Card creation successful:', {
                            newCardId: mirroredCard.id,
                            name: mirroredCard.name,
                            elapsedMs: Date.now() - startTime
                        });

                        mirroredCardId = mirroredCard.id;
                        this.cardMapping.set(cardMappingKey, mirroredCardId);
                        console.log('Card mapping updated:', {
                            key: cardMappingKey,
                            value: mirroredCardId,
                            totalMappings: this.cardMapping.size,
                            elapsedMs: Date.now() - startTime
                        });
                    } catch (createError) {
                        console.error('Card creation failed:', {
                            error: createError.message,
                            stack: createError.stack,
                            response: createError.response,
                            elapsedMs: Date.now() - startTime
                        });
                        throw createError;
                    }
                } catch (mainError) {
                    console.error('Error in main card creation flow:', {
                        error: mainError.message,
                        stack: mainError.stack,
                        response: mainError.response,
                        elapsedMs: Date.now() - startTime
                    });
                    throw mainError;
                }
            } else if (mirroredCardId) {
                console.log('\n=== START Card Update ===');
                if (isConfiguredList) {
                    try {
                        console.log('Updating existing mirrored card...');
                        const fullCard = await trelloApi.request(`/cards/${card.id}`);
                        const aggregateListId = this.listMapping.get(`aggregate-${targetList.name}`);

                        if (!aggregateListId) {
                            console.error('No aggregate list found for update:', {
                                lookupKey: `aggregate-${targetList.name}`,
                                availableMappings: Array.from(this.listMapping.entries())
                            });
                            return;
                        }

                        await trelloApi.updateCard(mirroredCardId, {
                            idList: aggregateListId,
                            idLabels: fullCard.labels ? fullCard.labels.map(label => label.id) : []
                        });
                        console.log('Card update complete:', {
                            cardId: mirroredCardId,
                            newListId: aggregateListId,
                            elapsedMs: Date.now() - startTime
                        });
                    } catch (updateError) {
                        console.error('Card update failed:', {
                            error: updateError.message,
                            stack: updateError.stack,
                            response: updateError.response,
                            elapsedMs: Date.now() - startTime
                        });
                        throw updateError;
                    }
                } else {
                    try {
                        console.log('Deleting mirrored card (moved to unconfigured list)');
                        await trelloApi.deleteCard(mirroredCardId);
                        this.cardMapping.delete(cardMappingKey);
                        console.log('Card deletion complete:', {
                            deletedCardId: mirroredCardId,
                            removedMapping: cardMappingKey,
                            elapsedMs: Date.now() - startTime
                        });
                    } catch (deleteError) {
                        console.error('Card deletion failed:', {
                            error: deleteError.message,
                            stack: deleteError.stack,
                            response: deleteError.response,
                            elapsedMs: Date.now() - startTime
                        });
                        throw deleteError;
                    }
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